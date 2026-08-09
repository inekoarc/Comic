using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public static class ComicFolderPicker {
  [ComImport]
  [Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  private class FileOpenDialog { }

  [ComImport]
  [Guid("D57C7288-D4AD-4768-BE02-9D969532D960")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, int fdap);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr pFilter);
    void GetResults(out IShellItemArray ppenum);
    void GetSelectedItems(out IShellItemArray ppsai);
  }

  [ComImport]
  [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, out IntPtr ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }

  [ComImport]
  [Guid("B63EA76D-1F85-456F-A19C-48159EFA858B")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItemArray {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppvOut);
    void GetPropertyStore(int flags, ref Guid riid, out IntPtr ppv);
    void GetPropertyDescriptionList(IntPtr keyType, ref Guid riid, out IntPtr ppv);
    void GetAttributes(int attribFlags, uint sfgaoMask, out uint psfgaoAttribs);
    void GetCount(out uint pdwNumItems);
    void GetItemAt(uint dwIndex, out IShellItem ppsi);
    void EnumItems(out IntPtr ppenumShellItems);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(
    [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
    IntPtr pbc,
    ref Guid riid,
    out IShellItem ppv
  );

  private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

  [DllImport("user32.dll")]
  private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll")]
  private static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

  [DllImport("user32.dll")]
  private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

  [DllImport("user32.dll")]
  private static extern bool SetForegroundWindow(IntPtr hWnd);

  private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  private const uint SWP_NOSIZE = 0x0001;
  private const uint SWP_NOMOVE = 0x0002;
  private const uint SWP_SHOWWINDOW = 0x0040;
  private const uint FOS_PICKFOLDERS = 0x00000020;
  private const uint FOS_FORCEFILESYSTEM = 0x00000040;
  private const uint FOS_ALLOWMULTISELECT = 0x00000200;
  private const uint FOS_PATHMUSTEXIST = 0x00000800;
  private const uint SIGDN_FILESYSPATH = 0x80058000;
  private const int ERROR_CANCELLED = unchecked((int)0x800704C7);

  [STAThread]
  public static int Main(string[] args) {
    string initial = args.Length > 0 ? args[0] : "";
    string outputFile = args.Length > 1 ? args[1] : "";
    try {
      string[] selectedPaths = Pick(initial);
      if (!String.IsNullOrWhiteSpace(outputFile)) {
        File.WriteAllLines(outputFile, selectedPaths, new UTF8Encoding(false));
      }
      return 0;
    } catch (Exception error) {
      if (!String.IsNullOrWhiteSpace(outputFile)) {
        File.WriteAllText(outputFile, "ERROR	" + error.Message, new UTF8Encoding(false));
      }
      return 1;
    }
  }

  private static string[] Pick(string initial) {
    IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
    uint options;
    dialog.GetOptions(out options);
    dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_ALLOWMULTISELECT | FOS_PATHMUSTEXIST);
    dialog.SetTitle("\u9009\u62e9\u6f2b\u753b\u76ee\u5f55");
    dialog.SetOkButtonLabel("\u6253\u5f00");

    if (!String.IsNullOrWhiteSpace(initial) && System.IO.Directory.Exists(initial)) {
      try {
        Guid shellItemGuid = typeof(IShellItem).GUID;
        IShellItem folder;
        SHCreateItemFromParsingName(initial, IntPtr.Zero, ref shellItemGuid, out folder);
        dialog.SetFolder(folder);
      } catch { }
    }

    int hr;
    using (Form owner = CreateHiddenOwnerWindow()) {
      StartDialogTopMostWatcher(owner.Handle);
      hr = dialog.Show(owner.Handle);
    }
    if (hr == ERROR_CANCELLED) return new string[0];
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);

    IShellItemArray results;
    dialog.GetResults(out results);
    uint count;
    results.GetCount(out count);
    List<string> paths = new List<string>();
    for (uint i = 0; i < count; i++) {
      IShellItem item;
      results.GetItemAt(i, out item);
      IntPtr pathPtr;
      item.GetDisplayName(SIGDN_FILESYSPATH, out pathPtr);
      string selectedPath = Marshal.PtrToStringUni(pathPtr);
      Marshal.FreeCoTaskMem(pathPtr);
      if (!String.IsNullOrWhiteSpace(selectedPath)) paths.Add(selectedPath);
    }
    return paths.ToArray();
  }

  private static Form CreateHiddenOwnerWindow() {
    Form owner = new Form();
    owner.ShowInTaskbar = false;
    owner.FormBorderStyle = FormBorderStyle.None;
    owner.StartPosition = FormStartPosition.Manual;
    owner.Opacity = 0;
    owner.Width = 1;
    owner.Height = 1;
    owner.Left = Screen.PrimaryScreen.WorkingArea.Left + (Screen.PrimaryScreen.WorkingArea.Width / 2);
    owner.Top = Screen.PrimaryScreen.WorkingArea.Top + (Screen.PrimaryScreen.WorkingArea.Height / 2);
    owner.TopMost = true;
    Icon appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    if (appIcon != null) owner.Icon = appIcon;
    owner.Show();
    return owner;
  }

  private static void StartDialogTopMostWatcher(IntPtr ownerHandle) {
    Thread watcher = new Thread(() => {
      DateTime deadline = DateTime.UtcNow.AddSeconds(8);
      while (DateTime.UtcNow < deadline) {
        IntPtr dialogHandle = FindDialogWindow(ownerHandle);
        if (dialogHandle != IntPtr.Zero) {
          SetWindowPos(dialogHandle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
          SetForegroundWindow(dialogHandle);
          return;
        }
        Thread.Sleep(50);
      }
    });
    watcher.IsBackground = true;
    watcher.SetApartmentState(ApartmentState.STA);
    watcher.Start();
  }

  private static IntPtr FindDialogWindow(IntPtr ownerHandle) {
    IntPtr found = IntPtr.Zero;
    uint currentProcessId = (uint)Process.GetCurrentProcess().Id;
    EnumWindows((hwnd, lParam) => {
      if (hwnd == ownerHandle || !IsWindowVisible(hwnd)) return true;
      uint processId;
      GetWindowThreadProcessId(hwnd, out processId);
      if (processId != currentProcessId) return true;
      StringBuilder className = new StringBuilder(256);
      GetClassName(hwnd, className, className.Capacity);
      if (className.ToString() == "#32770") {
        found = hwnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
