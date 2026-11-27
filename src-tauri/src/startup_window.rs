use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, WindowEvent};

static MAIN_SHOWN: AtomicBool = AtomicBool::new(false);

pub fn create(app: &mut tauri::App) -> tauri::Result<()> {
    let splash = tauri::window::WindowBuilder::new(app, "startup")
        .title("Treasure 正在启动…")
        .inner_size(1024.0, 768.0)
        .center()
        .resizable(false)
        .background_color(tauri::window::Color(245, 239, 228, 255))
        .build()?;

    if let Err(error) = add_content(&splash) {
        eprintln!("Unable to draw startup window: {error}");
    }
    let handle = app.handle().clone();
    splash.on_window_event(move |event| {
        if matches!(event, WindowEvent::CloseRequested { .. })
            && !MAIN_SHOWN.load(Ordering::Acquire)
        {
            tracing::info!("Startup window closed by user");
            handle.exit(0);
        }
    });

    let handle = app.handle().clone();
    std::thread::spawn(move || {
        let config = match handle
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
        {
            Some(config) => config.clone(),
            None => {
                show_failure(&handle, "Main window configuration is missing");
                return;
            }
        };
        let builder = match tauri::WebviewWindowBuilder::from_config(&handle, &config) {
            Ok(builder) => builder.visible(false).center(),
            Err(error) => {
                show_failure(
                    &handle,
                    &format!("Unable to configure main window: {error}"),
                );
                return;
            }
        };
        match builder.build() {
            Ok(window) => {
                #[cfg(windows)]
                {
                    let main_window = window.clone();
                    let _ = handle.run_on_main_thread(move || {
                        if let Err(error) = crate::windows_titlebar::install(&main_window) {
                            eprintln!("Unable to install Windows title bar: {error}");
                        }
                    });
                }
                let exit_handle = handle.clone();
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Destroyed) {
                        tracing::info!("Main window destroyed");
                        exit_handle.exit(0);
                    }
                });
                std::thread::sleep(std::time::Duration::from_secs(10));
                if !MAIN_SHOWN.load(Ordering::Acquire) {
                    tracing::warn!("Page load did not finish before the startup timeout; showing the main window");
                    reveal(&handle);
                }
            }
            Err(error) => {
                show_failure(&handle, &format!("Unable to create main window: {error}"));
            }
        }
    });
    Ok(())
}

fn show_failure(app: &tauri::AppHandle, message: &str) {
    eprintln!("{message}");
    if let Some(splash) = app.get_window("startup") {
        let _ = splash.set_title("Treasure 启动失败，请关闭后重试");
    }
}

pub fn reveal(app: &tauri::AppHandle) {
    if MAIN_SHOWN.swap(true, Ordering::AcqRel) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let splash = app.get_window("startup");
        let minimized = splash
            .as_ref()
            .and_then(|window| window.is_minimized().ok())
            .unwrap_or(false);
        if let Some(position) = splash
            .as_ref()
            .and_then(|window| window.outer_position().ok())
        {
            let _ = window.set_position(position);
        }
        if window.show().is_ok() {
            tracing::info!("Main window shown");
            if minimized {
                let _ = window.minimize();
            } else {
                let _ = window.set_focus();
            }
            if let Some(splash) = splash {
                let _ = splash.destroy();
            }
            return;
        }
    }
    MAIN_SHOWN.store(false, Ordering::Release);
}

#[cfg(target_os = "macos")]
fn add_content(window: &tauri::Window) -> Result<(), String> {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSFont, NSImage, NSImageView, NSTextAlignment, NSTextField,
        NSWindow,
    };
    use objc2_foundation::{ns_string, NSData, NSPoint, NSRect, NSSize};

    let marker = MainThreadMarker::new().ok_or("启动窗口必须在主线程创建")?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    let native: &NSWindow = unsafe { &*pointer.cast() };
    let content = native.contentView().ok_or("启动窗口内容不可用")?;
    let size = content.bounds().size;
    let flexible = NSAutoresizingMaskOptions::ViewMinXMargin
        | NSAutoresizingMaskOptions::ViewMaxXMargin
        | NSAutoresizingMaskOptions::ViewMinYMargin
        | NSAutoresizingMaskOptions::ViewMaxYMargin;

    let icon = NSImageView::new(marker);
    icon.setFrame(NSRect::new(
        NSPoint::new((size.width - 64.0) / 2.0, size.height / 2.0),
        NSSize::new(64.0, 64.0),
    ));
    icon.setAutoresizingMask(flexible);
    let icon_data = NSData::with_bytes(include_bytes!("../icons/icon.ico"));
    let image = NSImage::initWithData(NSImage::alloc(), &icon_data)
        .ok_or("启动窗口图标加载失败")?;
    icon.setImage(Some(&image));
    content.addSubview(&icon);

    let label = NSTextField::labelWithString(ns_string!("正在启动…"), marker);
    label.setFrame(NSRect::new(
        NSPoint::new((size.width - 200.0) / 2.0, size.height / 2.0 - 36.0),
        NSSize::new(200.0, 24.0),
    ));
    label.setAutoresizingMask(flexible);
    label.setAlignment(NSTextAlignment(1));
    label.setFont(Some(&NSFont::systemFontOfSize(16.0)));
    content.addSubview(&label);
    Ok(())
}

#[cfg(windows)]
fn add_content(window: &tauri::Window) -> Result<(), String> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{COLORREF, HINSTANCE, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{CreateSolidBrush, DeleteObject, HGDIOBJ};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Shell::SetWindowSubclass;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, GetClientRect, LoadImageW, SendMessageW, IMAGE_ICON, LR_SHARED,
        STM_SETICON, WINDOW_EX_STYLE, WINDOW_STYLE, WS_CHILD, WS_VISIBLE,
    };

    let parent = window.hwnd().map_err(|error| error.to_string())?;
    let mut rect = RECT::default();
    unsafe {
        GetClientRect(parent, &mut rect).map_err(|error| error.to_string())?;
        // STATIC controls otherwise paint their own system-coloured rectangles.
        let brush = CreateSolidBrush(COLORREF(0x00e4eff5));
        if brush.0.is_null() {
            return Err("无法创建启动窗口背景".into());
        }
        if !SetWindowSubclass(parent, Some(splash_subclass_proc), 0x5452_5350, brush.0 as usize).as_bool() {
            let _ = DeleteObject(HGDIOBJ(brush.0));
            return Err("无法设置启动窗口背景".into());
        }
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("STATIC"),
            w!("正在启动…"),
            WS_CHILD | WS_VISIBLE | WINDOW_STYLE(1),
            (rect.right - 200) / 2,
            (rect.bottom - 30) / 2 + 40,
            200,
            30,
            Some(parent),
            None,
            None,
            None,
        )
        .map_err(|error| error.to_string())?;
        let module = GetModuleHandleW(None).map_err(|error| error.to_string())?;
        let icon = LoadImageW(
            Some(HINSTANCE(module.0)),
            PCWSTR(32512usize as *const u16),
            IMAGE_ICON,
            64,
            64,
            LR_SHARED,
        )
        .map_err(|error| error.to_string())?;
        let icon_view = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("STATIC"),
            w!(""),
            WS_CHILD | WS_VISIBLE | WINDOW_STYLE(3),
            (rect.right - 64) / 2,
            (rect.bottom - 64) / 2 - 20,
            64,
            64,
            Some(parent),
            None,
            None,
            None,
        )
        .map_err(|error| error.to_string())?;
        SendMessageW(icon_view, STM_SETICON, Some(WPARAM(icon.0 as usize)), None);
    }
    Ok(())
}

#[cfg(windows)]
unsafe extern "system" fn splash_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    message: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _id: usize,
    brush: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::Graphics::Gdi::{DeleteObject, SetBkMode, HDC, HGDIOBJ, TRANSPARENT};
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::{WM_CTLCOLORSTATIC, WM_NCDESTROY};

    if message == WM_CTLCOLORSTATIC {
        unsafe { SetBkMode(HDC(wparam.0 as *mut _), TRANSPARENT) };
        return LRESULT(brush as isize);
    }
    let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
    if message == WM_NCDESTROY {
        let _ = unsafe { DeleteObject(HGDIOBJ(brush as *mut _)) };
    }
    result
}
