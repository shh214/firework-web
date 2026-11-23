# Firework

美国独立日烟花照片的两版滚动网页。两版共用照片图集、球体坐标和城市矩阵布局。

## 本地预览

将原 Firework 项目的 `us-fireworks-cloud/atlas.webp` 复制到本仓库的同名路径。图集留在本地，仓库包含页面和布局数据。完整照片、元数据和模型环境保存在原 Firework 项目中。

从仓库根目录运行下面的命令，再在浏览器里打开页面。

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

- [两段版](http://127.0.0.1:8000/us-fireworks-scroll/) · 球体与城市矩阵
- [三段版](http://127.0.0.1:8000/us-fireworks-scroll-three/) · 球体、城市矩阵与烟花色带

## 第三方依赖与照片

GSAP 和 ScrollTrigger 3.13.0 采用 [GreenSock Standard License](https://gsap.com/standard-license/)。版权和许可标注保留在 `us-fireworks-scroll/vendor/` 的文件中。

照片来自 Flickr。每张照片的来源、许可和署名信息见原 Firework 项目十城数据集的 `metadata.csv`。发布含照片的预览前，按逐张许可和作者要求确认展示与署名。
