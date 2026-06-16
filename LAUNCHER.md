# Windows 启动器

双击项目根目录中的 `ComicLauncher.exe`，启动器会：

1. 检查本机 `9000` 端口的漫画服务是否已经运行。
2. 未运行时，在后台通过 Node.js 启动 `server.js`。
3. 等待服务就绪，然后打开 `http://127.0.0.1:9000/#home`。

电脑需要安装 Node.js。也可以把 Windows 版 `node.exe` 放到项目根目录，启动器会优先使用它。

修改 `tools/ComicLauncher.cs` 后，可运行以下命令重新生成 EXE：

```powershell
powershell -ExecutionPolicy Bypass -File .\build-launcher.ps1
```
