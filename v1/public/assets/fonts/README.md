# 自托管字体

设计稿（`docs/design/README.md`，候光）指定这两款字体。原型从 Google Fonts 加载，
生产不能那样做——客户在国内，`fonts.googleapis.com` 多半连不上，页面会静默回落
到系统字体，首屏还可能被吊住。所以把拉丁子集下载到本站自行提供。

| 文件 | 字体 | 字重 | 来源 |
|---|---|---|---|
| `familjen-grotesk.woff2` | Familjen Grotesk | 400–700（可变字体，一个文件覆盖） | Google Fonts latin 子集 |
| `ibm-plex-mono-400.woff2` | IBM Plex Mono | 400 | 同上 |
| `ibm-plex-mono-500.woff2` | IBM Plex Mono | 500 | 同上 |
| `ibm-plex-mono-600.woff2` | IBM Plex Mono | 600 | 同上 |

合计约 48 KB。**只含拉丁字符**：中文照旧回落到 PingFang SC 等系统字体，与原型行为一致。

## 许可

两款均以 **SIL Open Font License 1.1** 发布，允许自托管与商用（2026-09-12 对上游核实）：

- Familjen Grotesk — Copyright 2021 The Familjen Grotesk Project Authors，设计 Familjen STHLM AB。
  许可原文 `https://github.com/google/fonts/blob/main/ofl/familjengrotesk/OFL.txt`
- IBM Plex Mono — Copyright © 2017 IBM Corp.，保留字体名 "Plex"。
  许可原文 `https://github.com/IBM/plex/blob/master/LICENSE.txt`

OFL 要求：可自由使用、嵌入、再分发；不得单独售卖字体本身；衍生版本不得使用保留字体名。
我们只是原样自托管，不改字体、不重命名，符合要求。

## 更新

需要新字重时，从 Google Fonts CSS API 取对应 latin 子集（`unicode-range` 含 `U+0000-00FF` 的那段），
下载 woff2 放这里，并在 `../customer.css` 顶部加一条 `@font-face`。
