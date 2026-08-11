//! Native accelerated composition for the CEF browser surface.
//!
//! CEF's accelerated paint callback hands the shell an IOSurface ID.  The
//! surface is imported into Metal and copied into a CAMetalLayer attached to
//! the Tauri webview.  All AppKit/CoreAnimation objects are created and used
//! on the main thread; the thread-local state is deliberately not shared with
//! Tokio tasks.

#![cfg_attr(any(target_os = "macos", windows), allow(unsafe_code))]

#[cfg(not(any(target_os = "macos", windows)))]
use onpeople_types::{AppError, BrowserBoundsRequest, BrowserFrame, ErrorCode};
#[cfg(not(any(target_os = "macos", windows)))]
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "macos")]
mod macos {
    use std::cell::RefCell;

    use objc2::{
        MainThreadMarker, MainThreadOnly, define_class, extern_methods, rc::Retained,
        runtime::ProtocolObject,
    };
    use objc2_app_kit::NSView;
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSObjectProtocol, NSUInteger};
    use objc2_io_surface::IOSurfaceRef;
    use objc2_metal::{
        MTLBlitCommandEncoder, MTLCommandBuffer, MTLCommandEncoder, MTLCommandQueue,
        MTLCreateSystemDefaultDevice, MTLDevice, MTLPixelFormat, MTLStorageMode,
        MTLTextureDescriptor, MTLTextureType, MTLTextureUsage,
    };
    use objc2_quartz_core::{CAMetalDrawable, CAMetalLayer};
    use tauri::{AppHandle, Manager, Runtime};

    use onpeople_types::{AppError, BrowserBoundsRequest, BrowserFrame, ErrorCode};

    thread_local! {
        static SURFACE: RefCell<Option<Surface>> = const { RefCell::new(None) };
    }

    define_class!(
        // SAFETY: NSView has no additional subclassing invariants. This view
        // owns no ivars and is restricted to AppKit's main thread.
        #[unsafe(super(NSView))]
        #[thread_kind = MainThreadOnly]
        #[name = "OnPeopleBrowserSurfaceView"]
        struct BrowserSurfaceView;

        impl BrowserSurfaceView {
            // The overlay displays the CEF IOSurface but must never become an
            // independent input target. BrowserPane owns pointer and wheel
            // forwarding, and split-view drags must continue across the image.
            #[unsafe(method_id(hitTest:))]
            fn hit_test(&self, _point: CGPoint) -> Option<Retained<NSView>> {
                None
            }
        }

        unsafe impl NSObjectProtocol for BrowserSurfaceView {}
    );

    impl BrowserSurfaceView {
        extern_methods!(
            #[unsafe(method(new))]
            #[unsafe(method_family = new)]
            fn new(mtm: MainThreadMarker) -> Retained<Self>;
        );
    }

    struct Surface {
        overlay: Retained<BrowserSurfaceView>,
        layer: Retained<CAMetalLayer>,
        device: Retained<ProtocolObject<dyn MTLDevice>>,
        queue: Retained<ProtocolObject<dyn MTLCommandQueue>>,
        visible: bool,
    }

    pub fn update_bounds<R: Runtime>(
        app: &AppHandle<R>,
        request: BrowserBoundsRequest,
    ) -> Result<(), AppError> {
        validate_bounds(&request)?;
        let main_app = app.clone();
        app.run_on_main_thread(move || {
            let Some(window) = main_app.get_webview_window("main") else {
                tracing::warn!("无法找到主窗口，跳过浏览器原生 surface bounds 更新");
                return;
            };
            let Ok(native_view) = window.ns_view() else {
                tracing::warn!("无法取得主窗口 NSView，跳过浏览器原生 surface bounds 更新");
                return;
            };
            let Some(native_view) = (unsafe { native_view.cast::<NSView>().as_ref() }) else {
                tracing::warn!("主窗口 NSView 句柄为空，跳过浏览器原生 surface bounds 更新");
                return;
            };
            let Some(_mtm) = MainThreadMarker::new() else {
                tracing::warn!("浏览器原生 surface bounds 更新不在 AppKit 主线程");
                return;
            };
            SURFACE.with(|surface| {
                let mut surface = surface.borrow_mut();
                if !request.visible {
                    if let Some(surface) = surface.as_mut() {
                        surface.visible = false;
                        surface.overlay.setHidden(true);
                    }
                    return;
                }
                let Some(current) = ensure_surface(&mut surface, native_view, _mtm) else {
                    return;
                };
                current.visible = true;
                let parent_height = native_view.bounds().size.height;
                // BrowserPane reports bounds in WKWebView's top-left content
                // coordinates. The native NSView returned by Tauri can span
                // the full titlebar area, so using its entire height shifts
                // the overlay upward by the titlebar inset and lets CEF cover
                // the React navigation toolbar. NSWindow's contentLayoutRect
                // is the matching unobscured content height on macOS.
                let content_layout_height = native_view
                    .window()
                    .map(|window| window.contentLayoutRect().size.height)
                    .unwrap_or(parent_height);
                let y = overlay_y(
                    parent_height,
                    content_layout_height,
                    request.y,
                    request.height,
                );
                current.overlay.setFrame(CGRect::new(
                    CGPoint::new(request.x, y),
                    CGSize::new(request.width, request.height),
                ));
                current.layer.setDrawableSize(CGSize::new(
                    request.width * request.scale_factor,
                    request.height * request.scale_factor,
                ));
                // `ensure_surface` creates the overlay hidden. Once a frame
                // has been presented, ordinary ResizeObserver callbacks must
                // not hide it again: doing so alternates hidden/visible with
                // incoming CEF frames and produces visible flashing.
            });
        })
        .map_err(|error| {
            AppError::internal(format!("无法安排浏览器原生 surface bounds 更新: {error}"))
        })
    }

    pub fn render_frame<R: Runtime>(
        app: &AppHandle<R>,
        frame: BrowserFrame,
    ) -> Result<(), AppError> {
        if frame.surface_kind != "iosurface" {
            return Err(AppError::new(
                ErrorCode::Unsupported,
                "当前平台不支持该 CEF 加速帧格式",
            ));
        }
        let main_app = app.clone();
        let (result_sender, result_receiver) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let result = (|| {
                let Some(window) = main_app.get_webview_window("main") else {
                    return Err(AppError::new(
                        ErrorCode::BrowserUnavailable,
                        "无法找到主窗口，丢弃 CEF 加速帧",
                    ));
                };
                let native_view = window.ns_view().map_err(|error| {
                    AppError::internal(format!("无法取得主窗口 NSView，丢弃 CEF 加速帧: {error}"))
                })?;
                let Some(_native_view) = (unsafe { native_view.cast::<NSView>().as_ref() }) else {
                    return Err(AppError::new(
                        ErrorCode::BrowserUnavailable,
                        "主窗口 NSView 句柄为空，丢弃 CEF 加速帧",
                    ));
                };
                let Some(_mtm) = MainThreadMarker::new() else {
                    return Err(AppError::new(
                        ErrorCode::BrowserUnavailable,
                        "CEF 加速帧不在 AppKit 主线程",
                    ));
                };
                // The frame lease in browser-host keeps the source IOSurface
                // alive until this synchronous copy has completed.
                SURFACE.with(|surface| {
                    let mut surface = surface.borrow_mut();
                    // A frame can arrive while the restored browser session is
                    // still hidden. Never create a full native layer from a frame
                    // alone: bounds/visibility from BrowserPane is authoritative.
                    let Some(current) = surface.as_mut() else {
                        return Err(AppError::new(
                            ErrorCode::BrowserUnavailable,
                            "CEF 原生 surface 尚未完成 bounds 初始化",
                        ));
                    };
                    if !current.visible {
                        return Ok(());
                    }
                    let rendered = current.render(&frame).map_err(|error| {
                        AppError::internal(format!(
                            "CEF 加速帧 Metal 合成失败 route={} frame={}: {error}",
                            frame.route_id, frame.sequence
                        ))
                    });
                    if rendered.is_ok() {
                        current.overlay.setHidden(false);
                    }
                    rendered
                })
            })();
            let _ = result_sender.send(result);
        })
        .map_err(|error| AppError::internal(format!("无法安排 CEF 加速帧合成: {error}")))
        .and_then(|()| {
            result_receiver
                .recv_timeout(std::time::Duration::from_millis(750))
                .map_err(|_| AppError::new(ErrorCode::RuntimeTimeout, "CEF 加速帧合成超时"))?
        })
    }

    fn validate_bounds(request: &BrowserBoundsRequest) -> Result<(), AppError> {
        let values = [
            request.x,
            request.y,
            request.width,
            request.height,
            request.scale_factor,
        ];
        if values.iter().any(|value| !value.is_finite())
            || request.width <= 0.0
            || request.height <= 0.0
            || request.scale_factor <= 0.0
            || request.width > 16_384.0
            || request.height > 16_384.0
        {
            return Err(AppError::invalid("浏览器原生 surface bounds 无效"));
        }
        Ok(())
    }

    fn overlay_y(
        parent_height: f64,
        content_layout_height: f64,
        request_y: f64,
        request_height: f64,
    ) -> f64 {
        let layout_height = if content_layout_height.is_finite() && content_layout_height > 0.0 {
            content_layout_height.min(parent_height)
        } else {
            parent_height
        };
        (layout_height - request_y - request_height).max(0.0)
    }

    fn ensure_surface<'a>(
        surface: &'a mut Option<Surface>,
        parent: &NSView,
        mtm: MainThreadMarker,
    ) -> Option<&'a mut Surface> {
        if surface.is_none() {
            let Some(device) = MTLCreateSystemDefaultDevice() else {
                tracing::warn!("系统没有可用的 Metal 设备，无法创建 CEF 原生 surface");
                return None;
            };
            let Some(queue) = device.newCommandQueue() else {
                tracing::warn!("Metal command queue 创建失败，无法创建 CEF 原生 surface");
                return None;
            };
            // The Tauri webview is a subview of the window content view. A
            // CAMetalLayer attached directly to the content layer is painted
            // below that webview and appears as a white browser surface. Use
            // a native overlay view so the CEF frame is composited above the
            // webview while the React toolbar remains in its own area.
            let overlay = BrowserSurfaceView::new(mtm);
            overlay.setWantsLayer(true);
            let layer = CAMetalLayer::new();
            layer.setDevice(Some(&device));
            layer.setPixelFormat(MTLPixelFormat::BGRA8Unorm);
            layer.setFramebufferOnly(false);
            layer.setHidden(true);
            overlay.setLayer(Some(&layer));
            parent.addSubview(&overlay);
            *surface = Some(Surface {
                overlay,
                layer,
                device,
                queue,
                visible: false,
            });
        }
        surface.as_mut()
    }

    impl Surface {
        fn render(&mut self, frame: &BrowserFrame) -> Result<(), String> {
            let id = frame
                .surface_handle
                .strip_prefix("iosurface:")
                .ok_or_else(|| "CEF IOSurface handle 前缀无效".to_owned())?
                .parse::<u32>()
                .map_err(|_| "CEF IOSurface ID 无效".to_owned())?;
            if id == 0 || frame.width == 0 || frame.height == 0 {
                return Err("CEF IOSurface 帧句柄或尺寸无效".to_owned());
            }
            let iosurface =
                IOSurfaceRef::lookup(id).ok_or_else(|| "CEF IOSurface 已不可用".to_owned())?;
            const BGRA_PIXEL_FORMAT: u32 = u32::from_be_bytes(*b"BGRA");
            let surface_width = iosurface.width();
            let surface_height = iosurface.height();
            let surface_row_bytes = iosurface.bytes_per_row();
            let minimum_alignment = self
                .device
                .minimumLinearTextureAlignmentForPixelFormat(MTLPixelFormat::BGRA8Unorm);
            let expected_row_bytes = surface_width
                .checked_mul(4)
                .ok_or_else(|| "CEF IOSurface 行跨度溢出".to_owned())?;
            if iosurface.pixel_format() != BGRA_PIXEL_FORMAT
                || surface_width != frame.width as usize
                || surface_height != frame.height as usize
                || surface_row_bytes < expected_row_bytes
                || minimum_alignment == 0
                || !surface_row_bytes.is_multiple_of(minimum_alignment)
            {
                return Err(format!(
                    "CEF IOSurface 格式不兼容: format={:#010x} size={}x{} stride={} alignment={} frame={}x{}",
                    iosurface.pixel_format(),
                    surface_width,
                    surface_height,
                    surface_row_bytes,
                    minimum_alignment,
                    frame.width,
                    frame.height
                ));
            }
            let descriptor = MTLTextureDescriptor::new();
            // CEF supplies a BGRA8 IOSurface.  The descriptor dimensions are
            // taken from the callback, never from an untrusted wire size.
            unsafe {
                descriptor.setWidth(surface_width as NSUInteger);
                descriptor.setHeight(surface_height as NSUInteger);
            }
            descriptor.setTextureType(MTLTextureType::Type2D);
            descriptor.setPixelFormat(MTLPixelFormat::BGRA8Unorm);
            descriptor.setUsage(MTLTextureUsage::ShaderRead);
            descriptor.setStorageMode(if self.device.hasUnifiedMemory() {
                MTLStorageMode::Shared
            } else {
                MTLStorageMode::Managed
            });
            let source = self
                .device
                .newTextureWithDescriptor_iosurface_plane(&descriptor, iosurface.as_ref(), 0)
                .ok_or_else(|| "Metal 无法从 CEF IOSurface 创建纹理".to_owned())?;
            self.layer
                .setDrawableSize(CGSize::new(frame.width as f64, frame.height as f64));
            let drawable = self
                .layer
                .nextDrawable()
                .ok_or_else(|| "CAMetalLayer 当前没有可用 drawable".to_owned())?;
            let destination = drawable.texture();
            let command_buffer = self
                .queue
                .commandBuffer()
                .ok_or_else(|| "Metal command buffer 创建失败".to_owned())?;
            let encoder = command_buffer
                .blitCommandEncoder()
                .ok_or_else(|| "Metal blit encoder 创建失败".to_owned())?;
            unsafe {
                encoder.copyFromTexture_toTexture(source.as_ref(), destination.as_ref());
            }
            encoder.endEncoding();
            command_buffer.presentDrawable(drawable.as_ref());
            command_buffer.commit();
            Ok(())
        }
    }

    #[cfg(test)]
    mod tests {
        use super::overlay_y;

        #[test]
        fn overlay_y_uses_content_layout_height_when_titlebar_is_in_parent() {
            assert_eq!(overlay_y(930.0, 878.0, 138.0, 600.0), 140.0);
        }

        #[test]
        fn overlay_y_keeps_existing_coordinates_without_a_titlebar_inset() {
            assert_eq!(overlay_y(878.0, 878.0, 138.0, 600.0), 140.0);
        }

        #[test]
        fn overlay_y_falls_back_to_parent_height_for_invalid_layout_height() {
            assert_eq!(overlay_y(878.0, 0.0, 138.0, 600.0), 140.0);
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::{render_frame, update_bounds};

#[cfg(windows)]
mod windows {
    use std::cell::RefCell;

    use tauri::{AppHandle, Manager, Runtime};
    use windows::{
        Win32::{
            Foundation::{HANDLE, HMODULE, HWND, POINT},
            Graphics::{
                Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL},
                Direct3D11::{
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11CreateDevice,
                    ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D,
                },
                DirectComposition::{
                    DCompositionCreateDevice, IDCompositionDevice, IDCompositionSurface,
                    IDCompositionTarget, IDCompositionVisual3,
                },
                Dxgi::Common::{DXGI_ALPHA_MODE_PREMULTIPLIED, DXGI_FORMAT_B8G8R8A8_UNORM},
                Dxgi::{IDXGIDevice, IDXGISurface},
            },
        },
        core::Interface,
    };

    use onpeople_types::{AppError, BrowserBoundsRequest, BrowserFrame, ErrorCode};

    thread_local! {
        static SURFACE: RefCell<Option<Surface>> = const { RefCell::new(None) };
    }

    struct Surface {
        hwnd: HWND,
        device: ID3D11Device,
        context: ID3D11DeviceContext,
        dcomp: IDCompositionDevice,
        _target: IDCompositionTarget,
        visual: IDCompositionVisual3,
        content: Option<IDCompositionSurface>,
        content_size: (u32, u32),
    }

    pub fn update_bounds<R: Runtime>(
        app: &AppHandle<R>,
        request: BrowserBoundsRequest,
    ) -> Result<(), AppError> {
        validate_bounds(&request)?;
        let main_app = app.clone();
        app.run_on_main_thread(move || {
            let Some(window) = main_app.get_webview_window("main") else {
                tracing::warn!("无法找到主窗口，跳过浏览器原生 surface bounds 更新");
                return;
            };
            let Ok(hwnd) = window.hwnd() else {
                tracing::warn!("无法取得主窗口 HWND，跳过浏览器原生 surface bounds 更新");
                return;
            };
            SURFACE.with(|surface| {
                let mut surface = surface.borrow_mut();
                let Some(current) = ensure_surface(&mut surface, hwnd) else {
                    return;
                };
                let result = unsafe {
                    current
                        .visual
                        .SetOffsetX2(request.x as f32)
                        .and_then(|_| current.visual.SetOffsetY2(request.y as f32))
                        .and_then(|_| {
                            current
                                .visual
                                .SetOpacity2(if request.visible { 1.0 } else { 0.0 })
                        })
                        .and_then(|_| current.dcomp.Commit())
                };
                if let Err(error) = result {
                    tracing::warn!(error = %error, "DirectComposition bounds 更新失败");
                }
            });
        })
        .map_err(|error| {
            AppError::internal(format!("无法安排浏览器原生 surface bounds 更新: {error}"))
        })
    }

    pub fn render_frame<R: Runtime>(
        app: &AppHandle<R>,
        frame: BrowserFrame,
    ) -> Result<(), AppError> {
        if frame.surface_kind != "d3d11-shared-texture" {
            return Err(AppError::new(
                ErrorCode::Unsupported,
                "当前平台不支持该 CEF 加速帧格式",
            ));
        }
        let main_app = app.clone();
        app.run_on_main_thread(move || {
            let Some(window) = main_app.get_webview_window("main") else {
                tracing::warn!(route_id = %frame.route_id, "无法找到主窗口，丢弃 CEF 加速帧");
                return;
            };
            let Ok(hwnd) = window.hwnd() else {
                tracing::warn!(route_id = %frame.route_id, "无法取得主窗口 HWND，丢弃 CEF 加速帧");
                return;
            };
            SURFACE.with(|surface| {
                let mut surface = surface.borrow_mut();
                let Some(current) = ensure_surface(&mut surface, hwnd) else {
                    return;
                };
                if let Err(error) = current.render(&frame) {
                    tracing::warn!(route_id = %frame.route_id, error = %error, "D3D11 CEF 加速帧合成失败");
                }
            });
        })
        .map_err(|error| AppError::internal(format!("无法安排 D3D11 加速帧合成: {error}")))
    }

    fn validate_bounds(request: &BrowserBoundsRequest) -> Result<(), AppError> {
        let values = [
            request.x,
            request.y,
            request.width,
            request.height,
            request.scale_factor,
        ];
        if values.iter().any(|value| !value.is_finite())
            || request.width <= 0.0
            || request.height <= 0.0
            || request.scale_factor <= 0.0
            || request.width > 16_384.0
            || request.height > 16_384.0
        {
            return Err(AppError::invalid("浏览器原生 surface bounds 无效"));
        }
        Ok(())
    }

    fn ensure_surface(surface: &mut Option<Surface>, hwnd: HWND) -> Option<&mut Surface> {
        if surface.as_ref().is_some_and(|current| current.hwnd != hwnd) {
            *surface = None;
        }
        if surface.is_none() {
            let mut device = None;
            let mut context = None;
            let mut feature_level = D3D_FEATURE_LEVEL::default();
            let flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
            let result = unsafe {
                D3D11CreateDevice(
                    None,
                    D3D_DRIVER_TYPE_HARDWARE,
                    HMODULE::default(),
                    flags,
                    None,
                    D3D11_SDK_VERSION,
                    Some(&mut device),
                    Some(&mut feature_level),
                    Some(&mut context),
                )
            };
            if let Err(error) = result {
                tracing::warn!(error = %error, "D3D11 设备创建失败");
                return None;
            }
            let (Some(device), Some(context)) = (device, context) else {
                tracing::warn!("D3D11 设备创建返回空接口");
                return None;
            };
            let Ok(dxgi_device) = device.cast::<IDXGIDevice>() else {
                tracing::warn!("D3D11 设备无法转换为 DXGI 设备");
                return None;
            };
            let Ok(dcomp) =
                (unsafe { DCompositionCreateDevice::<_, IDCompositionDevice>(&dxgi_device) })
            else {
                tracing::warn!("DirectComposition 设备创建失败");
                return None;
            };
            let Ok(target) = (unsafe { dcomp.CreateTargetForHwnd(hwnd, false) }) else {
                tracing::warn!("DirectComposition target 创建失败");
                return None;
            };
            let Ok(visual) = (unsafe { dcomp.CreateVisual() }) else {
                tracing::warn!("DirectComposition visual 创建失败");
                return None;
            };
            let Ok(visual) = visual.cast::<IDCompositionVisual3>() else {
                tracing::warn!("DirectComposition visual 无法升级到 Visual3");
                return None;
            };
            if unsafe { target.SetRoot(&visual) }.is_err() || unsafe { dcomp.Commit() }.is_err() {
                tracing::warn!("DirectComposition visual 根节点提交失败");
                return None;
            }
            *surface = Some(Surface {
                hwnd,
                device,
                context,
                dcomp,
                _target: target,
                visual,
                content: None,
                content_size: (0, 0),
            });
        }
        surface.as_mut()
    }

    impl Surface {
        fn render(&mut self, frame: &BrowserFrame) -> Result<(), String> {
            let handle = frame
                .surface_handle
                .strip_prefix("d3d11:")
                .ok_or_else(|| "CEF D3D11 handle 前缀无效".to_owned())?
                .parse::<usize>()
                .map_err(|_| "CEF D3D11 共享句柄无效".to_owned())?;
            if handle == 0 || frame.width == 0 || frame.height == 0 {
                return Err("CEF D3D11 帧句柄或尺寸无效".to_owned());
            }
            let mut source = None;
            unsafe {
                self.device
                    .OpenSharedResource(HANDLE(handle as *mut std::ffi::c_void), &mut source)
            }
            .map_err(|error| format!("D3D11 OpenSharedResource 失败: {error}"))?;
            let source: ID3D11Texture2D = source.ok_or_else(|| "D3D11 共享纹理为空".to_owned())?;
            if self.content_size != (frame.width, frame.height) {
                let content = unsafe {
                    self.dcomp.CreateSurface(
                        frame.width,
                        frame.height,
                        DXGI_FORMAT_B8G8R8A8_UNORM,
                        DXGI_ALPHA_MODE_PREMULTIPLIED,
                    )
                }
                .map_err(|error| format!("DirectComposition surface 创建失败: {error}"))?;
                unsafe {
                    self.visual
                        .SetContent(&content)
                        .map_err(|error| format!("DirectComposition surface 绑定失败: {error}"))?;
                }
                self.content = Some(content);
                self.content_size = (frame.width, frame.height);
            }
            let content = self
                .content
                .as_ref()
                .ok_or_else(|| "DirectComposition surface 尚未初始化".to_owned())?;
            let mut offset = POINT::default();
            let destination: IDXGISurface = unsafe { content.BeginDraw(None, &mut offset) }
                .map_err(|error| format!("DirectComposition BeginDraw 失败: {error}"))?;
            let destination = destination
                .cast::<ID3D11Resource>()
                .map_err(|error| format!("DComp surface 无法转换为 D3D11 resource: {error}"))?;
            unsafe { self.context.CopyResource(&destination, &source) };
            unsafe { content.EndDraw() }
                .map_err(|error| format!("DirectComposition EndDraw 失败: {error}"))?;
            unsafe { self.dcomp.Commit() }
                .map_err(|error| format!("DirectComposition 提交失败: {error}"))?;
            Ok(())
        }
    }
}

#[cfg(windows)]
pub use windows::{render_frame, update_bounds};

#[cfg(not(any(target_os = "macos", windows)))]
pub fn update_bounds<R: Runtime>(
    _app: &AppHandle<R>,
    _request: BrowserBoundsRequest,
) -> Result<(), AppError> {
    Err(AppError::new(
        ErrorCode::Unsupported,
        "当前平台尚未实现 CEF 原生 surface 合成",
    ))
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn render_frame<R: Runtime>(_app: &AppHandle<R>, _frame: BrowserFrame) -> Result<(), AppError> {
    Err(AppError::new(
        ErrorCode::Unsupported,
        "当前平台尚未实现 CEF 原生 surface 合成",
    ))
}
