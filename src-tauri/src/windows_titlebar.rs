//! Windows-specific support for the custom HTML title bar.
//!
//! Tauri already installs the resize border handler for undecorated windows.
//! This additional subclass only identifies the rendered maximize button as a
//! caption button so Windows 11 can show its native Snap Layout flyout.

use tauri::WebviewWindow;
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    UI::{
        HiDpi::GetDpiForWindow,
        Shell::{DefSubclassProc, SetWindowSubclass},
        WindowsAndMessaging::{GetWindowRect, HTMAXBUTTON, WM_NCHITTEST},
    },
};

const SUBCLASS_ID: usize = 0x5452_4553;
const TITLEBAR_HEIGHT_DIP: i32 = 40;
const CAPTION_BUTTON_WIDTH_DIP: i32 = 46;

pub fn install(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        if !SetWindowSubclass(hwnd, Some(titlebar_subclass_proc), SUBCLASS_ID, 0).as_bool() {
            return Err(windows::core::Error::from_thread().to_string());
        }
    }
    Ok(())
}

unsafe extern "system" fn titlebar_subclass_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _reference_data: usize,
) -> LRESULT {
    if message == WM_NCHITTEST && is_maximize_button(hwnd, lparam) {
        return LRESULT(HTMAXBUTTON as isize);
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

fn is_maximize_button(hwnd: HWND, lparam: LPARAM) -> bool {
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return false;
    }

    let dpi = unsafe { GetDpiForWindow(hwnd) } as i32;
    let scale = |dip: i32| (dip * dpi + 95) / 96;
    let titlebar_height = scale(TITLEBAR_HEIGHT_DIP);
    let caption_button_width = scale(CAPTION_BUTTON_WIDTH_DIP);
    let cursor_x = (lparam.0 as u32 & 0xffff) as i16 as i32;
    let cursor_y = ((lparam.0 as u32 >> 16) & 0xffff) as i16 as i32;

    cursor_y >= rect.top
        && cursor_y < rect.top + titlebar_height
        && cursor_x >= rect.right - (caption_button_width * 2)
        && cursor_x < rect.right - caption_button_width
}
