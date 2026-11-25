# Firework

美国独立日烟花照片的两版滚动网页。两版共用球体坐标和城市矩阵布局。

## 本地预览

从原 Firework 项目复制所需图集到本仓库的同名路径。两段版使用 `us-fireworks-cloud/atlas.webp`，三段版使用 `us-fireworks-scroll-three/fireworks-atlas.webp`。完整照片、元数据和模型环境保存在原 Firework 项目中。

重新生成三段版图集时，在原 Firework 项目根目录，用装有 Pillow、NumPy 和 SciPy 的 Python 运行 `python3 firework-web/us-fireworks-scroll-three/build_atlas.py`。生成的图集位于原项目的 `us-fireworks-scroll-three/`，复制到本仓库的同名路径后即可预览。在生成命令末尾加上 `--full-size` 可同时导出原尺寸透明 PNG，按照片 ID 命名，存放在原项目的 `us-fireworks-scroll-three/cutouts/`。

从仓库根目录运行下面的命令，再在浏览器里打开页面。

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

- [两段版](http://127.0.0.1:8000/us-fireworks-scroll/) · 球体与城市矩阵
- [三段版](http://127.0.0.1:8000/us-fireworks-scroll-three/) · 球体、城市矩阵与烟花色带
- [照片预览](http://127.0.0.1:8000/us-fireworks-scroll-three/photos.html) · 浏览三段版的去背景照片

## 第三方依赖与照片

GSAP 和 ScrollTrigger 3.13.0 采用 [GreenSock Standard License](https://gsap.com/standard-license/)。版权和许可标注保留在 `us-fireworks-scroll/vendor/` 的文件中。

照片来自 Flickr。每张照片的来源、许可和署名信息见原 Firework 项目十城数据集的 `metadata.csv`。发布含照片的预览前，按逐张许可和作者要求确认展示与署名。
