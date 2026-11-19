---
title: '绕过 Qt 写死的边框，给原生 QWhatsThis 画圆角'
description: '在 Qt 5.15.2 中为原生 QWhatsThis 帮助弹窗绘制圆角和阴影，保留正文与链接交互，并附最小示例。'
date: 2026-11-19
category: '技术'
format: article
tags: ['Qt', 'Qt Widgets', 'QWhatsThis', '弹窗', '圆角']
draft: false
sample: false
---

# 绕过 Qt 写死的边框，给原生 QWhatsThis 画圆角

Qt 5.15.2 在帮助窗口的 `paintEvent()` 里直接调用 `QPainter::drawRect()` 画出内外两道边。调色板能换颜色，重写 `QStyle::drawPrimitive()` 却接不到这两笔。要改形状，可以在 `QEvent::Polish` 时找到 Qt 创建的弹窗。**给它安装 `QGraphicsEffect`，就能改变 Qt 画出的结果。在它的事件过滤器中接下 `QEvent::Paint`，则可以自己绘制整张帮助卡片。**

下面的对照来自同一个按钮、同一段 JPEG 说明。两次都通过 `QWhatsThis::showText()` 打开，也都能用 Esc 或 `hideText()` 关闭。

| Qt 默认样式 | 安装 EyStyle |
| --- | --- |
| ![默认 QWhatsThis，浅黄底色和双线矩形边框内显示 JPEG 说明](/images/qt-whatsthis-rounded-popup/01-jpeg-qt.png) | ![同一段 JPEG 说明位于深色圆角面板内](/images/qt-whatsthis-rounded-popup/02-jpeg-eystyle.png) |

## 从哪里接手这个窗口？

`QWhatsThis` 提供的是静态接口。真正显示在屏幕上的是 Qt 内部创建的 `QWhatsThat`，一个带 `Qt::Popup` 标志的 `QWidget`。它在构造时调用 `ensurePolished()`，让样式在测量文字前生效。因此可以在样式的 `polish(QApplication *)` 里安装应用级事件过滤器，在窗口收到 `QEvent::Polish` 时识别它。以只改外框为例，过滤器中起作用的是这几行，`RoundedHelpEffect` 的完整代码在文末。

```cpp
QWidget *const popup = qobject_cast<QWidget *>(object);
if (event->type() == QEvent::Polish && popup && popup->inherits("QWhatsThat") && !popup->graphicsEffect())
{
    popup->setWindowFlags(popup->windowFlags() | Qt::FramelessWindowHint | Qt::NoDropShadowWindowHint);
    popup->setAttribute(Qt::WA_TranslucentBackground);
    popup->setGraphicsEffect(new RoundedHelpEffect(popup));
}
```

在 Windows 上，无边框和透明背景让窗口的每个像素都有机会透出底色。**开启透明背景不会擦掉 Qt 已画好的方角。** 如果把原图整张贴回来，旧方框照样可见。接下来该保留哪部分画面，取决于样式能否拿到**这次调用实际要显示的文字**。

| 帮助从哪里打开 | 样式能取到什么 | 正文和链接怎样处理 |
| --- | --- | --- |
| 程序直接调用 `QWhatsThis::showText(pos, text, target)` | Qt 画好的窗口。参数 `text` 保存在私有对象里 | 用 `QGraphicsEffect` 合成外框，保留 Qt 的正文和链接布局 |
| 控件用 `setWhatsThis()` 注册帮助，由默认帮助模式或 `Shift+F1` 打开 | 目标控件的 `whatsThis()` 就是本次原文 | 在原窗口处理 `Paint` 事件，用同一份 `QTextDocument` 绘制正文和命中链接 |

## 只有 Qt 的绘制结果时，裁下正文

目标控件有 `whatsThis()` 属性，也不能据此推断一次 `showText()` 的内容。比如下拉框注册的帮助是“选择图像的保存格式”，点击按钮时传给 Qt 的却是“JPEG 适合需要较小文件的照片”。从属性重新排版会显示错文字。此时最可靠的素材是 Qt 自己画出来的正文，包括字形、图片和富文本链接。

只改圆角时，可以用 `drawSource()` 让 Qt 画完整个窗口，只重画正文外面的一圈。EyStyle 还要给投影留空间，因此先按**可见面板宽度**取图，再把窗口四周各扩出 8 个逻辑像素。如果先扩大窗口再取图，Qt 画纯文本时会把多出来的 16 个像素算进可用行宽，行尾的字可能换到另一行。下面的 `m_nativeSize` 是首次显示时 Qt 算出的大小，`panelPosition` 是可见面板在屏幕上的左上角。

```cpp
QScopedValueRollback<bool> const guard(m_updating, true);
const QSize panelSize(qMax(themeWidth, m_nativeSize.width()), m_nativeSize.height());
m_widgetPopup->resize(panelSize);
m_nativeContent = m_widgetPopup->grab();
m_widgetPopup->setGeometry(QRect(panelPosition, panelSize).marginsAdded(QMargins(8, 8, 8, 8)));
```

`grab()` 本身也会触发绘制，所以取图期间要让 `drawSource()` 运行 Qt 的原始绘制。回到正常显示时，先画新面板，再从快照中只贴回正文。下例展开了合成圆角的部分，实际主题还会在清理外围后、填充面板前绘制投影。

```cpp
void draw(QPainter *painter) override
{
    if (m_updating)
    {
        drawSource(painter);
        return;
    }
    const QRect bounds = m_widgetPopup->rect();
    const QRect panel = bounds.adjusted(8, 8, -8, -8);
    const QRect content = panel.adjusted(12, 8, -12, -8);
    painter->save();
    painter->setClipRegion(QRegion(bounds).subtracted(content), Qt::IntersectClip);
    painter->setCompositionMode(QPainter::CompositionMode_Source);
    painter->fillRect(bounds, Qt::transparent);
    painter->restore();

    painter->save();
    painter->setCompositionMode(QPainter::CompositionMode_SourceOver);
    painter->setRenderHint(QPainter::Antialiasing);
    painter->setPen(QPen(m_widgetPopup->palette().dark(), 1));
    painter->setBrush(m_widgetPopup->palette().toolTipBase());
    painter->drawRoundedRect(QRectF(panel).adjusted(0.5, 0.5, -0.5, -0.5), 3, 3);
    painter->setClipRect(content, Qt::IntersectClip);
    painter->drawPixmap(panel.topLeft(), m_nativeContent);
    painter->restore();
}
```

`panel` 扣掉的是 EyStyle 给投影留的空间。`content` 再扣掉 Qt 5.15.2 的正文内边距，左右 12、上下 8，旧边框就落在裁剪区外。清理外围时使用 `CompositionMode_Source`，透明色能把原像素的 alpha 写成零。用默认的 `SourceOver` 叠加透明色，原像素会完整保留。

**绘制平移多少，点击就要反向平移多少。** 原来在面板 `(40, 24)` 的链接，现在显示在窗口 `(48, 32)`。弹窗的鼠标事件过滤器先执行 `mouse->setLocalPos(mouse->localPos() - panel.topLeft())`，再返回 `false` 放行，Qt 就会在原文档的正确位置查找链接。按在投影区域则直接关闭弹窗。

![浅沙色桌面背景上的帮助弹窗，面板与按钮左侧对齐，投影落在对齐线外](/images/qt-whatsthis-rounded-popup/03-windows-shadow.png)

*Windows 桌面实测。与按钮左边缘对齐的是可见面板，投影占用它外侧的空间。*

## 拿得到原文时，在 Paint 事件中重排

如果还要控制标题间距、正文行高或长文滚动，就需要一份可以重新排版的文档。在默认帮助模式中，应用级过滤器能在目标控件收到 `QEvent::WhatsThis` 或 `Shift+F1` 时读到 `widget->whatsThis()`。先暂存这份原文和目标指针，放行事件，让 Qt 照常创建弹窗。在同一次调用的 `Polish` 事件中取走它。对于动态生成、又需要主题排版的正文，EyStyle 也提供 `EyStyle::showWhatsThis()` 显式传入原文。

现在可以给这个窗口安装事件过滤器，用自己的 `QTextDocument` 排版。例如以下样式给标题留 6 个逻辑像素、给段落留 8 个。`contentWidth` 是扣除边框、内边距及可见滚动条之后的宽度。

```cpp
m_document->setDefaultStyleSheet(QStringLiteral("h3 { margin: 0 0 6px; } p { margin: 0 0 8px; }"));
if (Qt::mightBeRichText(text))
{
    m_document->setHtml(text);
}
else
{
    m_document->setPlainText(text);
}
m_document->setTextWidth(contentWidth);
```

下面是窗口事件过滤器里决定结果的分支。`paintFrame()` 绘制前文的主题面板，`m_content` 是正文视口。最后的 **`return true`** 会结束这次事件分发，Qt 的 `paintEvent()` 就不会再用两次 `drawRect()` 盖过我们画好的内容。

```cpp
if (event->type() == QEvent::Paint)
{
    QPainter painter(m_widgetPopup);
    paintFrame(painter);
    painter.setClipRect(m_content);
    painter.translate(m_content.topLeft() - QPoint(0, m_scrollBarScroll->value()));
    QAbstractTextDocumentLayout::PaintContext context;
    context.palette = m_widgetPopup->palette();
    context.palette.setBrush(QPalette::Text, context.palette.toolTipText());
    m_document->documentLayout()->draw(&painter, context);
    return true;
}
```

排版一变，链接的位置也会变。绘制时减去滚动量，命中时加回来，再向**刚才画字的同一份文档**查询链接。

```cpp
const QPoint inDocument = mouse->pos() - m_content.topLeft() + QPoint(0, m_scrollBarScroll->value());
const QString href = m_document->documentLayout()->anchorAt(inDocument);
```

鼠标按下、松开都命中正文里的同一链接时，向原目标发送 `QWhatsThisClickedEvent(href)`。目标处理事件并返回 `true`，帮助框就继续显示。这样即便长文滚到了最后一段，用户点中的仍是眼前那个链接。

## 升级 Qt 时验证什么？

这套做法使用了两个 Qt 5.15.2 的私有实现细节。**类名 `QWhatsThat`** 决定过滤器能否认出窗口，**正文内边距**决定裁下来的图里有没有旧边框、缺不缺字。我们在 100% 和 150% 缩放下固定面板宽度，把合成后的正文移回投影留边，再与 Qt 的原始输出逐像素比较。交互则要在实际画出的链接文字上点击一次，检查目标收到的地址。仅看四个角，发现不了换行和命中位置的偏差。

## 可运行的最小圆角示例

下面的 `main.cpp` 只依赖 Qt 5.15 Widgets。示例沿用系统调色板，在 Qt 画完后，仅将正文周围的一圈重绘为 6 个逻辑像素的圆角。正文坐标不动，链接点击可以直接交给 Qt。

```cpp
#include <QApplication>
#include <QEvent>
#include <QGraphicsEffect>
#include <QPainter>
#include <QPalette>
#include <QPen>
#include <QPoint>
#include <QProxyStyle>
#include <QPushButton>
#include <QRect>
#include <QRegion>
#include <QStringList>
#include <QWhatsThis>
#include <QWidget>

class RoundedHelpEffect final : public QGraphicsEffect
{
public:
    explicit RoundedHelpEffect(QWidget *popup) : QGraphicsEffect(popup), m_widgetPopup(popup) {}

protected:
    void draw(QPainter *painter) override
    {
        drawSource(painter);
        const QRect bounds = m_widgetPopup->rect();
        const QRect content = bounds.adjusted(12, 8, -12, -8);
        painter->save();
        painter->setClipRegion(QRegion(bounds).subtracted(content), Qt::IntersectClip);
        painter->setCompositionMode(QPainter::CompositionMode_Source);
        painter->fillRect(bounds, Qt::transparent);
        painter->setCompositionMode(QPainter::CompositionMode_SourceOver);
        painter->setRenderHint(QPainter::Antialiasing);
        painter->setPen(QPen(m_widgetPopup->palette().dark(), 1));
        painter->setBrush(m_widgetPopup->palette().toolTipBase());
        painter->drawRoundedRect(QRectF(bounds).adjusted(0.5, 0.5, -0.5, -0.5), 6, 6);
        painter->restore();
    }

private:
    QWidget *m_widgetPopup;
};

class RoundedHelpStyle final : public QProxyStyle
{
public:
    void polish(QApplication *application) override
    {
        QProxyStyle::polish(application);
        application->installEventFilter(this);
    }

    void unpolish(QApplication *application) override
    {
        application->removeEventFilter(this);
        QProxyStyle::unpolish(application);
    }

protected:
    bool eventFilter(QObject *object, QEvent *event) override
    {
        if (event->type() == QEvent::Polish)
        {
            QWidget *const popup = qobject_cast<QWidget *>(object);
            if (popup && popup->inherits("QWhatsThat") && !popup->graphicsEffect())
            {
                popup->setWindowFlags(popup->windowFlags() | Qt::FramelessWindowHint | Qt::NoDropShadowWindowHint);
                popup->setAttribute(Qt::WA_TranslucentBackground);
                popup->setGraphicsEffect(new RoundedHelpEffect(popup));
            }
        }
        return QProxyStyle::eventFilter(object, event);
    }
};

int main(int argc, char **argv)
{
    QApplication app(argc, argv);
    if (!app.arguments().contains(QStringLiteral("--native")))
    {
        QApplication::setStyle(new RoundedHelpStyle);
    }
    QPushButton button(QObject::tr("查看 JPEG 格式说明"));
    button.setWhatsThis(QObject::tr("选择图像的保存格式。"));
    const auto showHelp = [&button]
    {
        const QPoint below = button.mapToGlobal(QPoint(button.width() / 2, button.height()));
        QWhatsThis::showText(below, QObject::tr("<b>JPEG</b><p>有损压缩，适合需要较小文件的照片。</p>"), &button);
    };
    QObject::connect(&button, &QPushButton::clicked, &button, showHelp);
    button.show();
    return app.exec();
}
```

将下面的 `RoundedHelp.pro` 与 `main.cpp` 放在同一目录，用 Qt Creator 打开并运行。点击按钮会显示动态 JPEG 说明，聚焦按钮按 `Shift+F1` 会显示注册的格式说明。加 `--native` 启动可对照 Qt 默认边框。

```qmake
QT += widgets
CONFIG += c++17
SOURCES += main.cpp
msvc: QMAKE_CXXFLAGS += /utf-8
```
