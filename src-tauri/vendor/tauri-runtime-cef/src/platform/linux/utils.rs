// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{
  cell::RefCell,
  ffi::CString,
  os::raw::{c_long, c_ulong},
  sync::LazyLock,
};
use x11_dl::xlib;

const NET_WM_STATE_REMOVE: c_long = 0;
const NET_WM_STATE_ADD: c_long = 1;
const NET_ACTIVE_WINDOW_SOURCE_PAGER: c_long = 2;
const CURRENT_TIME: c_long = 0;
const CLIENT_MESSAGE: i32 = 33;
const SUBSTRUCTURE_REDIRECT_MASK: c_long = 1 << 20;
const SUBSTRUCTURE_NOTIFY_MASK: c_long = 1 << 19;

static XLIB: LazyLock<Option<xlib::Xlib>> = LazyLock::new(|| xlib::Xlib::open().ok());

struct Display(*mut xlib::Display);

thread_local! {
  static DISPLAY: RefCell<Option<Display>> = const { RefCell::new(None) };
}

pub(super) fn with_cef_display<R>(
  default: R,
  f: impl FnOnce(&xlib::Xlib, *mut xlib::Display) -> R,
) -> R {
  let Some(xlib) = XLIB.as_ref() else {
    return default;
  };
  let display = cef::get_xdisplay() as *mut xlib::Display;
  if display.is_null() {
    return default;
  }

  let result = f(xlib, display);
  unsafe {
    (xlib.XFlush)(display);
  }
  result
}

pub(super) fn with_x11<R>(default: R, f: impl FnOnce(&xlib::Xlib, *mut xlib::Display) -> R) -> R {
  let Some(xlib) = XLIB.as_ref() else {
    return default;
  };

  DISPLAY.with(|cell| {
    let mut guard = cell.borrow_mut();
    if guard.is_none() {
      let display = unsafe { (xlib.XOpenDisplay)(std::ptr::null()) };
      if display.is_null() {
        return default;
      }
      *guard = Some(Display(display));
    }

    let display = guard.as_ref().unwrap().0;
    let result = f(xlib, display);
    unsafe {
      (xlib.XFlush)(display);
    }
    result
  })
}

pub(super) fn atom(xlib: &xlib::Xlib, display: *mut xlib::Display, name: &str) -> c_ulong {
  let cname = CString::new(name).unwrap();
  unsafe { (xlib.XInternAtom)(display, cname.as_ptr(), 0) }
}

/// Ask the window manager to make `xid` the active window.
///
/// The source indication is `2` ("pager"): EWMH tells window managers to treat
/// those requests as if they came from the user, which is what gets past the
/// focus-stealing prevention that would otherwise turn the request into a
/// taskbar highlight. `1` ("application") would need a valid user input
/// timestamp we do not have when a window is created.
pub(super) fn activate_window(xid: c_ulong) {
  with_x11((), |xlib, display| {
    let net_active_window = atom(xlib, display, "_NET_ACTIVE_WINDOW");

    unsafe {
      (xlib.XRaiseWindow)(display, xid);

      let root = (xlib.XDefaultRootWindow)(display);
      let mut event: xlib::XEvent = std::mem::zeroed();
      event.client_message = xlib::XClientMessageEvent {
        type_: CLIENT_MESSAGE,
        serial: 0,
        send_event: 1,
        display,
        window: xid,
        message_type: net_active_window,
        format: 32,
        data: xlib::ClientMessageData::from([
          NET_ACTIVE_WINDOW_SOURCE_PAGER,
          CURRENT_TIME,
          // No requestor window: the request is about our own window.
          0,
          0,
          0,
        ]),
      };
      (xlib.XSendEvent)(
        display,
        root,
        0,
        SUBSTRUCTURE_REDIRECT_MASK | SUBSTRUCTURE_NOTIFY_MASK,
        &mut event,
      );
    }
  });
}

pub(super) fn set_wm_state(xid: c_ulong, add: bool, atom1: &str, atom2: Option<&str>) {
  with_x11((), |xlib, display| {
    let wm_state = atom(xlib, display, "_NET_WM_STATE");
    let a1 = atom(xlib, display, atom1);
    let a2 = atom2.map(|name| atom(xlib, display, name)).unwrap_or(0);
    let action = if add {
      NET_WM_STATE_ADD
    } else {
      NET_WM_STATE_REMOVE
    };

    unsafe {
      let root = (xlib.XDefaultRootWindow)(display);
      let mut event: xlib::XEvent = std::mem::zeroed();
      event.client_message = xlib::XClientMessageEvent {
        type_: CLIENT_MESSAGE,
        serial: 0,
        send_event: 1,
        display,
        window: xid,
        message_type: wm_state,
        format: 32,
        data: xlib::ClientMessageData::from([action, a1 as c_long, a2 as c_long, 1, 0]),
      };
      (xlib.XSendEvent)(
        display,
        root,
        0,
        SUBSTRUCTURE_REDIRECT_MASK | SUBSTRUCTURE_NOTIFY_MASK,
        &mut event,
      );
    }
  });
}

unsafe fn tree(xlib: &xlib::Xlib, display: *mut xlib::Display, window: c_ulong) -> Option<(c_ulong, c_ulong, Vec<c_ulong>)> {
  let (mut root, mut parent, mut children, mut count) = (0, 0, std::ptr::null_mut(), 0);
  if unsafe { (xlib.XQueryTree)(display, window, &mut root, &mut parent, &mut children, &mut count) } == 0 {
    return None;
  }
  let list = if children.is_null() { Vec::new() } else { unsafe { std::slice::from_raw_parts(children, count as usize).to_vec() } };
  if !children.is_null() {
    unsafe { (xlib.XFree)(children.cast()) };
  }
  Some((root, parent, list))
}

unsafe fn drop_target(xlib: &xlib::Xlib, display: *mut xlib::Display, window: c_ulong, aware: c_ulong) -> Option<c_ulong> {
  let (mut kind, mut format, mut count, mut after, mut data) = (0, 0, 0, 0, std::ptr::null_mut());
  unsafe { (xlib.XGetWindowProperty)(display, window, aware, 0, 1, 0, 0, &mut kind, &mut format, &mut count, &mut after, &mut data) };
  if !data.is_null() {
    unsafe { (xlib.XFree)(data.cast()) };
  }
  if kind != 0 {
    return Some(window);
  }
  unsafe { tree(xlib, display, window) }?.2.into_iter().find_map(|child| unsafe { drop_target(xlib, display, child, aware) })
}

pub(crate) fn proxy_drops(browser: c_ulong) {
  std::thread::spawn(move || {
    for _ in 0..50 {
      let done = with_x11(true, |xlib, display| unsafe {
        let Some(target) = drop_target(xlib, display, browser, atom(xlib, display, "XdndAware")) else {
          return false;
        };
        let proxy = atom(xlib, display, "XdndProxy");
        let mut window = target;
        loop {
          (xlib.XChangeProperty)(display, window, proxy, xlib::XA_WINDOW, 32, xlib::PropModeReplace, (&target as *const c_ulong).cast(), 1);
          match tree(xlib, display, window) {
            Some((root, parent, _)) if parent != root && parent != 0 => window = parent,
            _ => return true,
          }
        }
      });
      if done {
        return;
      }
      std::thread::sleep(std::time::Duration::from_millis(100));
    }
  });
}
