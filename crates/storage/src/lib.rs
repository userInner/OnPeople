#![deny(unsafe_op_in_unsafe_fn)]

mod keychain;
mod legacy;
mod migrations;
mod paths;
mod repository;

pub use keychain::{Keychain, LegacySecret};
pub use legacy::{LegacyImportReport, MigrationJournal, MigrationStatus};
pub use paths::{DataPaths, stable_data_root};
pub use repository::Storage;
