using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Comic Launcher")]
[assembly: AssemblyDescription("Windows launcher for the local comic library")]
[assembly: AssemblyProduct("漫画管理器")]
[assembly: AssemblyCompany("Comic")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class ComicLauncher
{
    private const int Port = 9000;
    private const string LocalUrl = "http://127.0.0.1:9000/#home";

    [STAThread]
    private static void Main(string[] args)
    {
        bool openBrowser = Array.IndexOf(args, "--no-browser") < 0;
        string projectDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string serverScript = Path.Combine(projectDirectory, "server.js");

        if (!File.Exists(serverScript))
        {
            ShowError("启动器旁边没有找到 server.js。\n\n请将 ComicLauncher.exe 放在漫画项目根目录中。");
            return;
        }

        try
        {
            if (!IsServerReady())
            {
                StartServer(projectDirectory, serverScript);
                if (!WaitForServer())
                {
                    ShowError("漫画服务未能在 9000 端口启动。\n\n请确认 9000 端口未被其他程序占用，并检查 Node.js 是否可以正常运行。");
                    return;
                }
            }

            if (openBrowser)
            {
                Process.Start(new ProcessStartInfo(LocalUrl) { UseShellExecute = true });
            }
        }
        catch (Exception error)
        {
            ShowError("启动漫画管理器失败：\n\n" + error.Message);
        }
    }

    private static void StartServer(string projectDirectory, string serverScript)
    {
        string localNode = Path.Combine(projectDirectory, "node.exe");
        string nodeCommand = File.Exists(localNode) ? localNode : "node";
        var startInfo = new ProcessStartInfo
        {
            FileName = nodeCommand,
            Arguments = "\"" + serverScript + "\"",
            WorkingDirectory = projectDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        startInfo.EnvironmentVariables["HOST"] = "127.0.0.1";
        startInfo.EnvironmentVariables["PORT"] = Port.ToString();

        try
        {
            Process process = Process.Start(startInfo);
            if (process == null)
            {
                throw new InvalidOperationException("无法创建 Node.js 服务进程。");
            }
        }
        catch (System.ComponentModel.Win32Exception)
        {
            throw new InvalidOperationException("未找到 Node.js。请先安装 Node.js，或将 node.exe 放到项目根目录。");
        }
    }

    private static bool WaitForServer()
    {
        for (int attempt = 0; attempt < 40; attempt++)
        {
            Thread.Sleep(250);
            if (IsServerReady()) return true;
        }
        return false;
    }

    private static bool IsServerReady()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/api/sync-progress");
            request.Method = "GET";
            request.Timeout = 500;
            request.ReadWriteTimeout = 500;
            using (var response = (HttpWebResponse)request.GetResponse())
            {
                return (int)response.StatusCode >= 200 && (int)response.StatusCode < 500;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void ShowError(string message)
    {
        MessageBox.Show(message, "漫画管理器", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
