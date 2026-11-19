---
title: 'Qt Widgets 弹窗黑角与动画黑底：从圆角、阴影到 QRollEffect'
description: '以 Windows 10 和 Qt 5.15.2 为例，记录组合框、菜单和工具提示的圆角黑底、阴影留边及滚动动画透明修复，并说明如何用桌面像素验证。'
date: 2026-11-19
category: '技术'
format: article
tags: ['Qt', 'Qt Widgets', 'Windows', '弹窗', 'QRollEffect']
draft: false
sample: false
---

给组合框的下拉列表画了圆角，停稳后，四个角外仍然各露出一小块黑底。修好黑角、加上阴影后，又遇到了另一种黑底：只在列表展开途中出现，动画一结束就消失。

这次排查发生在 Windows 10 22H2、Qt 5.15.2 的 Qt Widgets 应用中。**停稳后仍有黑角，先查真实弹窗；只有中间帧发黑，还要查动画期间替它显示的窗口。** 两处修复都放在应用安装的 `QStyle` 中，业务代码仍用 Qt 自带的控件。

## 圆角外的黑色从哪里来

![组合框四角的黑色背景（现场截图）](/images/qt-popup-corners-and-animation/01-combo-corners.png)

*图 1　组合框已经完全展开。红框标出了面板四角与下方界面之间的黑色。*

把面板画成圆角，只决定 `QPainter` 往哪些像素写颜色。Windows 最后要把整块矩形窗口叠到桌面上。如果这个窗口表面没有逐像素透明度（alpha），画笔绕开的四个角也无法透出下面的界面。这里说的是显示到桌面上的顶层窗口，不只是圆角面板本身。`WA_NoSystemBackground` 只让 Qt 跳过背景擦除。即使窗口本身已经透明，子控件填的一层矩形底色，或 Windows 另外加的一层矩形阴影，仍然可能露在圆角外。[Qt 的透明窗口说明](https://github.com/qt/qtbase/blob/v5.15.2/src/widgets/kernel/qwidget.cpp#L770-L785) · [Qt 的 Windows 光栅输出](https://github.com/qt/qtbase/blob/v5.15.2/src/plugins/platforms/windows/qwindowsbackingstore.cpp#L86-L121)

## 把透明属性设给真正弹出的窗口

最容易设错对象的是组合框。`QComboBox` 留在主窗口里，列表由另一个顶层窗口承载。在列表展开时查看 `combo->view()->window()->metaObject()->className()`，就能看到 Qt 实际显示的窗口类名。

| 打开弹窗的控件 | Qt 5.15.2 中要处理的窗口 |
| --- | --- |
| `QComboBox`、`QFontComboBox` | `view()->window()` 指向 `QComboBoxPrivateContainer` |
| 菜单、带菜单的 `QToolButton` | 弹出的 `QMenu` 本身 |
| 启用了 `calendarPopup` 的 `QDateEdit` | `calendarWidget()->window()` 指向 `QCalendarPopup` |
| `QToolTip` | Qt 创建的顶层 `QTipLabel` |
| Qt 自绘 `QFileDialog` 的文件名建议 | `QCompleter::popup()` 默认使用独立的 `QListView` |

先找到实际弹出的顶层窗口，再在它首次显示、创建原生句柄之前配置透明。下面摘出 Windows 路径的关键代码，只对已经识别的目标调用。用按位或保留原有窗口类型及标志；`NoDropShadowWindowHint` 用来关掉系统阴影，逐像素透明则由 `WA_TranslucentBackground` 配合无边框窗口实现。

```cpp
void preparePopupBeforeCreation(QWidget *window)
{
#ifdef Q_OS_WIN
    const auto flags = window->windowFlags()
                     | Qt::FramelessWindowHint
                     | Qt::NoDropShadowWindowHint;
    window->setWindowFlags(flags);
    window->setAttribute(Qt::WA_TranslucentBackground);
#endif
}
```

Qt 5 的 `QMenu::popup()` 在某些路径会先创建 Windows 窗口句柄（HWND），之后才进入样式的 `polish()`。我们在菜单构造自带 `QAction` 的 `ChildAdded` 事件中就准备好窗口属性。运行中换样式是另一条路径：只有已有句柄且配置确实需要变化时，原实现才重建原生表面。上面的片段不包含这部分，也不要在已经显示的弹窗上反复调用。日历还要多查一层，只关掉弹窗内部 `QCalendarWidget` 的 `autoFillBackground`，否则它会在圆角下再铺一块矩形。

文件名补全保留原来的列表和委托。Qt 5 的补全委托直接画图标和文字，我们在视口里补画悬停行的底色，键盘选择仍交给 Qt。

![工具提示在深青、浅沙底色上的四角，放大五倍](/images/qt-popup-corners-and-animation/02-tooltip-corners.png)

*图 2　把工具提示的四角放大五倍。下排是去掉黑角、还没有添加主题阴影时的结果。同一个边缘能分别透出深青和浅沙。*

## 加阴影：区分面板矩形和窗口矩形

黑角消失后，深色菜单贴在深色界面上，两层有些难分。普通按钮仍然平贴在界面上，我们只给浮在内容上方的弹窗加阴影。项目要覆盖 Windows 10，主题还要能控制投影颜色，因此选择在同一个透明窗口里绘制。

这里选择在透明窗口内自己画阴影，既能覆盖 Windows 10，也能控制主题投影颜色。不要把 Windows 11 的系统圆角当成透明窗口的通用补救：微软将使用逐像素 alpha 的分层窗口列为例外。[微软的圆角说明](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-rounded-corners)

以 `QMenu` 为例，Qt 算出的屏幕矩形就是用户应当看见的菜单面板。我们把顶层窗口向四周各扩八个逻辑像素，再在窗口内部找回面板的位置。

```cpp
const QMargins shadowMargins(8, 8, 8, 8);
const QRect outerOnScreen = panelOnScreen.marginsAdded(shadowMargins);
const QRect windowBounds(QPoint(0, 0), outerOnScreen.size());
const QRect panelInWindow = windowBounds.marginsRemoved(shadowMargins);
```

绘制时先清空上次留下的透明边带，再叠画渐淡的圆角投影，向下偏移两个逻辑像素，向外扩散六个。随后剔除面板轮廓内的投影，最后画面板。清边带这一步能防止鼠标每次悬停重绘都把阴影加深。定位和点击也要分清这两个矩形，菜单面板仍对齐按钮，点在阴影上只收起菜单。

![两种底色下加入阴影前后的原生 QMenu](/images/qt-popup-corners-and-animation/03-menu-shadow.png)

*图 3　两种底色上的同一个 QMenu。右列只有展开的菜单有投影，上方按钮和菜单左边缘依然对齐。*

## 只在展开途中出现的黑底

![同一组合框展开途中和展开完成的两张现场截图](/images/qt-popup-corners-and-animation/04-gallery-roll.png)

*图 4　同一次展开的两张现场截图，裁取了相同区域。上图的黑带和给阴影预留的空间一样宽，下图的同一位置已经能透出底色。*

这两张图让排查换了方向。如果真实弹窗的透明配置又失效了，黑带应当在列表停稳后继续存在。要看到中间发生了什么，可以在应用事件过滤器中记录顶层窗口的 `QEvent::Show` 和 `metaObject()->className()`。展开组合框时，会发现短暂可见的窗口名叫 `QRollEffect`。即使打开的是组合框，它的窗口类型也是 `Qt::ToolTip`。

在 Qt 5.15.2 中，启用 `UI_AnimateCombo` 的普通下拉列表会调用 `qScrollEffect()`，组合框传入的时长是 150 毫秒。Qt 用 `QWidget::grab()` 抓取目标弹窗，再由 `QRollEffect` 移动、裁切这张快照，逐帧展开。动画结束才显示真实弹窗。快照里已经有透明边带和阴影，而这个辅助窗口只设了 `WA_NoSystemBackground`。在浅沙底色上实测，滚动期间外沿读到的是纯黑 `#000000`。[组合框的展开分支](https://github.com/qt/qtbase/blob/v5.15.2/src/widgets/widgets/qcombobox.cpp#L2908-L2944) · [Qt 的快照与滚动绘制](https://github.com/qt/qtbase/blob/v5.15.2/src/widgets/widgets/qeffects.cpp#L391-L431)

`QFontComboBox` 继承同一条路径。工具提示在启用 `UI_AnimateTooltip`、没有选择淡入时也使用滚动。显式开启 `UI_FadeTooltip` 时，Qt 5.15.2 在 Windows 上调整真实提示窗口的透明度，排查时要先确认实际启用哪一种效果。[Qt 工具提示的动画选择](https://github.com/qt/qtbase/blob/v5.15.2/src/widgets/kernel/qtooltip.cpp#L520-L530)

## 让滚动动画的窗口也支持逐像素透明

用和真实弹窗相同的方式给 `QRollEffect` 准备透明表面，就可以保留 Qt 原来的滚动方向、时长和系统动画偏好。下面只示意样式识别窗口的条件；`popup` 表示已识别的真实弹窗，调用点仍要满足前面所说的创建时机。

```cpp
const bool roll = widget->windowType() == Qt::ToolTip
               && widget->inherits("QRollEffect");
if (popup || roll)
{
    preparePopupBeforeCreation(widget);
}
```

阴影、边距、定位和点击处理都只交给真实弹窗。辅助窗口拿到的快照已经包含阴影，给它再留八个像素会改变滚动几何，再画一层则会使投影加深。工具提示还要在 Qt 抓快照前补偿一次阴影边距，否则接回真实 `QTipLabel` 的那一瞬，文字会平移八个像素。`QRollEffect` 是 Qt 的私有类名，升级 Qt 时应重新核对这条显示路径。

![组合框、字体组合框、工具提示展开中间帧的 Windows 桌面对照](/images/qt-popup-corners-and-animation/05-roll-regression.png)

*图 5　浅沙底色、100% 缩放的桌面中间帧。右列从上到下是向下展开的组合框、靠近屏幕下沿而向上展开的字体组合框，以及工具提示。三者都保留了滚动和柔和的阴影。*

## 用桌面像素验收

我们把深青 `#20657A` 和浅沙 `#F2D59C` 铺在弹窗下方，在 100% 和 150% 缩放下各测一次。七类弹窗得到 28 组静态对照，三个会滚动的控件另有 12 组中间帧。只截 `widget->grab()` 很容易错过故障，它拿到的是 Qt 已经画好的像素。测试用 `QScreen::grabWindow(0, …)` 抓取 Windows 合成后的桌面，并在动画窗口展开到至少三分之一、尚未完全展开时取样。

先用面板内一个不透明像素确认桌面已经呈现了这一帧，再读外沿。完全透明处应该等于下方原色，半透明阴影的每个颜色通道应接近 `α × 阴影色 + (1 − α) × 底色`。每个 8 位通道允许相差 2，以容纳取整误差。如果弹窗盖在文件列表上，就先在同一位置截一张弹窗关闭时的底图，用它逐点比较。

## 遇到类似问题，先截这两张图

1. **停稳后截图。** 还有黑角，就确认透明属性设在实际的顶层弹窗，而不是组合框本身。再排除内部矩形填充和系统阴影。
2. **展开到一半截图。** 只有这张发黑，就记录当时显示的顶层窗口。若走的是 Qt 5.15.2 的 `QRollEffect` 路径，辅助窗口也要支持逐像素透明，但不用再加阴影或边距。
3. **换一块明显不同的底色重测。** 在真实桌面上看同一位置是否透出对应底色，同时检查投影、菜单对齐和点击行为。测试要覆盖动画中间帧，不能只看最终状态。
