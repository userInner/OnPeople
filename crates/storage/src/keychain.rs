use std::fmt;

use aes::Aes128;
use base64::Engine;
use cbc::cipher::{BlockDecryptMut, KeyIvInit, block_padding::Pkcs7};
use keyring::Entry;
use onpeople_types::{AppError, ErrorCode};
#[cfg(target_os = "macos")]
use pbkdf2::pbkdf2_hmac;
#[cfg(target_os = "macos")]
use sha1::Sha1;

const KEYCHAIN_SERVICE: &str = "OnPeople";
const KEYCHAIN_ACCOUNT_PREFIX: &str = "onpeople:";

#[derive(Debug, Clone)]
pub struct Keychain {
    namespace: String,
}

impl Keychain {
    #[must_use]
    pub fn new(namespace: impl Into<String>) -> Self {
        Self {
            namespace: namespace.into(),
        }
    }

    fn entry(&self, name: &str) -> Result<Entry, AppError> {
        let account = format!("{KEYCHAIN_ACCOUNT_PREFIX}{}:{name}", self.namespace);
        Entry::new(KEYCHAIN_SERVICE, &account).map_err(|error| {
            AppError::new(ErrorCode::Keychain, "无法访问系统钥匙串").context("cause", error)
        })
    }

    pub fn set(&self, name: &str, value: &str) -> Result<(), AppError> {
        self.entry(name)?.set_password(value).map_err(|error| {
            AppError::new(ErrorCode::Keychain, "无法保存系统凭据").context("cause", error)
        })
    }

    pub fn get(&self, name: &str) -> Result<Option<String>, AppError> {
        match self.entry(name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => {
                Err(AppError::new(ErrorCode::Keychain, "无法读取系统凭据").context("cause", error))
            }
        }
    }

    pub fn delete(&self, name: &str) -> Result<(), AppError> {
        match self.entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => {
                Err(AppError::new(ErrorCode::Keychain, "无法删除系统凭据").context("cause", error))
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct LegacySecret {
    pub key: [u8; 16],
    pub source: &'static str,
}

impl LegacySecret {
    #[must_use]
    pub fn discover() -> Vec<Self> {
        #[cfg(target_os = "macos")]
        let mut secrets = Vec::new();
        #[cfg(not(target_os = "macos"))]
        let secrets = Vec::new();
        #[cfg(target_os = "macos")]
        {
            let candidates = [("OnPeople Safe Storage", "OnPeople Key")];
            for (service, account) in candidates {
                if let Ok(entry) = Entry::new(service, account) {
                    if let Ok(password) = entry.get_password() {
                        let mut key = [0_u8; 16];
                        pbkdf2_hmac::<Sha1>(password.as_bytes(), b"saltysalt", 1_003, &mut key);
                        secrets.push(Self {
                            key,
                            source: "macos-keychain",
                        });
                    }
                }
            }
        }
        secrets
    }

    #[must_use]
    pub fn decrypt(&self, encrypted: &[u8]) -> Option<String> {
        if encrypted.len() < 4 || (!encrypted.starts_with(b"v10") && !encrypted.starts_with(b"v11"))
        {
            return None;
        }
        let mut payload = encrypted[3..].to_vec();
        type Decryptor = cbc::Decryptor<Aes128>;
        let decrypted = Decryptor::new(&self.key.into(), b"                ".into())
            .decrypt_padded_mut::<Pkcs7>(&mut payload)
            .ok()?;
        String::from_utf8(decrypted.to_vec()).ok()
    }
}

impl fmt::Display for LegacySecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.source)
    }
}

pub fn decrypt_legacy_safe_storage_value(value: &str) -> Result<Option<String>, AppError> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|error| {
            AppError::new(ErrorCode::Migration, "旧版凭据编码损坏").context("cause", error)
        })?;
    for secret in LegacySecret::discover() {
        if let Some(clear) = secret.decrypt(&decoded) {
            return Ok(Some(clear));
        }
    }
    #[cfg(windows)]
    if let Some(clear) = decrypt_dpapi(&decoded)? {
        return Ok(Some(clear));
    }
    Ok(None)
}

#[cfg(windows)]
#[allow(unsafe_code)]
fn decrypt_dpapi(encrypted: &[u8]) -> Result<Option<String>, AppError> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CRYPT_INTEGER_BLOB, CryptUnprotectData},
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    let success = unsafe {
        CryptUnprotectData(
            &mut input,
            null_mut(),
            null(),
            null(),
            null_mut(),
            0,
            &mut output,
        )
    };
    if success == 0 {
        return Ok(None);
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(String::from_utf8(bytes).ok())
}
