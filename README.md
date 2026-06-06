# 本地漫画库

一个本地后端 + 前端的漫画管理和阅读项目。页面结构参考在线漫画目录站：顶部导航、搜索、首页更新列表、漫画库、排行榜、分类页、漫画详情页和阅读页。后端负责扫描本地漫画文件夹、提供图片，并把评分和标签保存到 `data/metadata.json`。

## 启动

```bash
npm start
```

然后打开：

```text
http://127.0.0.1:9000
```

## 本地文件夹结构

推荐这样放。第一层文件夹会识别为分类，第二层文件夹会识别为具体漫画：

```text
漫画总文件夹/
  分类A/
    漫画1/
      001.jpg
      002.jpg
    漫画2/
      001.png
      002.png
  分类B/
    漫画3/
      001.webp
```

系统会把每个分类下的具体漫画文件夹识别为一本漫画，并按文件名自然排序。若分类文件夹里直接放了图片，也会兜底识别为一本同名漫画。

## 功能

- 漫画库和排行榜分区
- 服务端扫描本地漫画文件夹
- 漫画详情页支持添加标签
- 漫画详情页支持 0-10 分评分
- 排行榜按评分自动排序
- 分页/长卷阅读、宽度/高度适配、亮度调节
- 标签和评分保存在项目内 `data/metadata.json`
- 漫画根目录保存在项目内 `data/config.json`

- `index.html` - page structure
- `styles.css` - responsive visual design
- `app.js` - comic data and interactions
- `server.js` - local API and static server
- `data/metadata.json` - generated after rating/tag changes
- `data/config.json` - generated after setting the library path
- `assets/` - 示例漫画素材
