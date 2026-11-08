//! PC sleep and shutdown. Windows tells every top-level window, a hidden one included (a message-only window hears
//! no broadcasts), before it suspends or ends the session; the handler runs then, while the PC still waits.
use std::sync::OnceLock;

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, MSG, PBT_APMSUSPEND,
    RegisterClassW, WINDOW_EX_STYLE, WINDOW_STYLE, WM_POWERBROADCAST, WM_QUERYENDSESSION,
    WNDCLASSW,
};
use windows::core::w;

type Handler = Box<dyn Fn() + Send + Sync>;
static ON_POWER_OFF: OnceLock<Handler> = OnceLock::new();

/// Calls `on_power_off` on its own thread when the PC is about to sleep, shut down, restart or sign out.
/// ponytail: a shutdown that another app then cancels still runs it; the tablet only turns its screen off.
pub fn watch(on_power_off: impl Fn() + Send + Sync + 'static) {
    if ON_POWER_OFF.set(Box::new(on_power_off)).is_err() {
        return;
    }
    std::thread::spawn(|| unsafe {
        let Ok(module) = GetModuleHandleW(None) else {
            return;
        };
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: module.into(),
            lpszClassName: w!("SupaDashboardAndroidPower"),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            eprintln!("android: power window class failed");
            return;
        }
        // Never shown: no WS_VISIBLE, zero size.
        if CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class.lpszClassName,
            w!(""),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            None,
            None,
            Some(class.hInstance),
            None,
        )
        .is_err()
        {
            eprintln!("android: power window failed");
            return;
        }
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            DispatchMessageW(&message);
        }
    });
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let suspend = message == WM_POWERBROADCAST && wparam.0 == PBT_APMSUSPEND as usize;
    if (suspend || message == WM_QUERYENDSESSION)
        && let Some(handler) = ON_POWER_OFF.get()
    {
        handler();
    }
    // Agrees to the session ending and acknowledges power events.
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}
