---
title: 'Qt Widgets 属性面板为什么有两种底色？排查 QScrollArea、分隔条和滑轨'
description: '在 Qt 5.15.2 中逐层定位 QScrollArea 视口和内容控件的背景填充，再处理分隔手柄与滚动条，并附 Fusion 取色复现。'
date: 2026-11-19
category: '技术'
format: article
tags: ['Qt', 'Qt Widgets', 'QScrollArea', 'QSplitter', 'QScrollBar']
draft: false
sample: false
---

一个 Qt Widgets 页面加上可滚动的“属性设置”后，标题和表单看起来像放在两块面板上。标题周围是墨蓝色 `#222733`，复选框之间的留白却是更深的 `#191e28`。输入框有自己的底色很自然，奇怪的是，连没有控件的地方也跟着变了色。

![属性设置面板的现场截图，红框内标题和表单留白深浅不同](/images/qt-widget-background-inheritance/01-property-panel.png)

*图 1　沿着右侧面板从标题往下看，底色恰好在可滚动表单的上沿发生变化。*

**先找色差从哪一层开始，不必急着把两处调色板改成同一个颜色。** 这次色差的边界正好对应控件树。标题和搜索框直接放在面板里，下方的属性行放在一个无边框的 `QScrollArea` 里。每次重建表单，页面先创建一块新的内容，再往布局里添加属性行。与背景有关的代码只有这几行。

```cpp
QWidget *const content = new QWidget(m_scrollAreaProperties);
m_layoutProperties = new QVBoxLayout(content);
m_layoutProperties->setContentsMargins(0, 8, 8, 8);
m_layoutProperties->setSpacing(14);
m_scrollAreaProperties->setWidget(content);
```

这里有两层可能盖住父面板的控件。外面是滚动区域的视口 `viewport()`，里面是承载属性行的 `content`。如果内容铺满整个视口，肉眼很难分清深色究竟是谁画的。

## 用 Fusion 隔离视口和内容的两次填充

用 Qt 5.15.2 自带的 Fusion 样式做一个小实验。把一块 42 × 32 的内容放进 150 × 76 的无边框滚动区域，让内容只占视口的一角。抓取整块面板，就能从同一张图里读出外层面板、视口裸露处、内容内部三个像素。下表是在 `offscreen` 平台、100% 缩放下依次修改同一组控件得到的结果。文末附有可直接编译的完整程序。

| 在上一步基础上做的修改 | 外层面板 | 视口裸露处 | 内容内部 |
| --- | --- | --- | --- |
| Fusion 初始状态 | `#efefef` | `#efefef` | `#efefef` |
| 父面板自行绘制墨蓝色 | `#222733` | `#efefef` | `#efefef` |
| 关闭视口的自动填充 | `#222733` | `#222733` | `#efefef` |
| 再关闭内容的自动填充 | `#222733` | `#222733` | `#222733` |

第一行颜色一致，并不代表只有父面板画了底色。普通非原生子控件可以接着父控件已经画好的背景往上画。子控件开启 `autoFillBackground` 后，Qt 又会在它自己的绘制事件之前，用其 `backgroundRole()` 对应的画刷铺底。`QAbstractScrollArea` 创建视口时开启了这项填充，`QScrollArea::setWidget()` 又给传入的内容控件开启一次。[Qt 的父背景传播](https://github.com/qt/qtbase/blob/v5.15.2/src/widgets/kernel/qwidget.cpp#L655-L698) · [视口的初始化](https://github.com/qt/qtbase/blob/v5.15.2/src/widgets/widgets/qabstractscrollarea.cpp#L260-L267) · [setWidget 对内容控件的处理](https://github.com/qt/qtbase/blob/v5.15.2/src/widgets/widgets/qscrollarea.cpp#L236-L254)

第二行只在父面板的 `paintEvent()` 里画了一层墨蓝色，父面板的调色板仍是灰色。第三行最能说明问题。执行 `area.viewport()->setAutoFillBackground(false)` 后，只有露在内容矩形以外的那圈变成墨蓝色。等到第四行再执行 `content->setAutoFillBackground(false)`，矩形内部才跟着变色。

原问题和第二行相似。自定义样式给面板绘制了 `#222733`，同时给滚动区域和视口配置了 `#191e28` 的背景画刷。默认配色下难以察觉的两次填充，在这里留下了一块清晰的矩形。`NoFrame` 控制的是边框，表格里的四步用的都是同一个无边框视口。

## 让普通布局显示父面板的背景

如果只要修复一个确定应透出父背景的普通滚动表单，先在应用代码验证这三行：

```cpp
area->setWidget(content);
area->viewport()->setAutoFillBackground(false);
content->setAutoFillBackground(false);
```

顺序不能反过来：`setWidget()` 会替新内容开启自动填充。每次替换内容都要重新处理。如果视口本来就需要自有底色，只考虑关闭内容这一层；如果样式表或绘制代码仍然填背景，这三行也不会替你移除它。

对于供多个页面使用的主题，我把规则下沉到样式层，范围只覆盖普通 `QScrollArea` 的视口及 `setWidget()` 安装的直接内容。不递归关闭所有子控件的填充，也不把这套规则套到编辑器和项目视图上。Breeze 同样会根据边框和背景角色筛选需要处理的视口和子控件，可作为另一种实现参考。[Breeze 的相关判断](https://github.com/KDE/breeze/blob/b0832e7e6f974e64f59e593bc43704ea59108636/kstyle/breezestyle.cpp#L551-L570)

先看背景角色，再看控件有没有接管绘制。

```cpp
bool isLayoutRole(QPalette::ColorRole role)
{
    return role == QPalette::Window || role == QPalette::Button;
}

bool ownsBackground(const QWidget *widget)
{
    return widget->testAttribute(Qt::WA_StyleSheetTarget) || widget->testAttribute(Qt::WA_StyledBackground) ||
           widget->testAttribute(Qt::WA_OpaquePaintEvent);
}
```

这里的 `Window`、`Button` 是该样式选用的布局角色，不是 Qt 对所有滚动区域的规定。以下是样式内部的判断片段；几个辅助函数和状态记录未展开。应用可以显式给视口指定画刷，同时让表单留白继续透出这个视口。

```cpp
QWidget *const viewport = area->viewport();
const bool layout = isLayoutRole(area->backgroundRole()) && isLayoutRole(viewport->backgroundRole()) &&
                    !ownsBackground(area) && !ownsBackground(viewport);
const bool explicitArea = hasExplicitBackground(area);
adapt(viewport, area, layout && !explicitArea && !hasExplicitBackground(viewport));
if (QWidget *const content = area->widget())
{
    adapt(content,
          area,
          layout && isLayoutRole(content->backgroundRole()) && !ownsBackground(content) &&
              !hasExplicitBackground(content));
}
```

`hasExplicitBackground()` 用样式写入主题色**之前**记录的调色板，以 `original.isBrushSet(QPalette::Active, widget->backgroundRole())` 检查当前背景角色在 Active 颜色组是否显式设了画刷。关键是不要把主题刚写入的颜色当成应用指定的颜色；若主题还需要识别只给其他颜色组设置的画刷，也要相应扩展判断。最后一个参数为真时，`adapt()` 记下原有的填充状态，执行 `widget->setAutoFillBackground(false)`。普通表单可以露出父面板的纯色、渐变或图案，文本编辑器和项目视图则继续绘制自己的内容区。

还要处理换页。Qt 可能在内容已经过 `polish()` 之后才由 `setWidget()` 打开自动填充，因此样式在显示和父控件变化时重新检查。内容通过 `takeWidget()` 离开滚动区域，或者应用卸载样式时，样式会恢复此前改过的值。属性面板从头到尾只用开篇那段原生 Qt 代码。

## 从面板留白到分隔条和滚动条

表单的底色连上了，再看同一示例中的 QTimeEdit 页面，还有两条细长的色带。左边分隔手柄的内部是 `#292f3d`，右边滑轨的空白段是 `#1d232e`，旁边都是 `#222733`。这一次沿色差边界找过去，会分别落到 `QSplitterHandle` 和 `QScrollBar` 的绘制区域。

![属性表单底色统一后，两个红框分别标出分隔手柄和滚动条滑轨](/images/qt-widget-background-inheritance/02-splitter-and-track.png)

*图 2　这里比较的是手柄上远离握持标记的位置，以及滑块下方的空轨道。*

### 分隔容器和手柄各画一次

原来的样式在 `PE_Widget` 给 `QSplitter` 铺一层主题色，又在 `CE_Splitter` 给手柄铺另一层。只让手柄透明，露出来的仍会是分隔容器的底色。现在两个绘制入口在常态下都调用 `layoutBackgroundBrush()`。下面是有控件可供查询时的分支。这里的 `group` 是绘制状态对应的调色板颜色组。

```cpp
const QPalette::ColorRole role = widget->backgroundRole();
const QPalette original = originalBackgroundPalette(widget);
if (original.isBrushSet(group, role) || !isLayoutRole(role) || widget->autoFillBackground() || widget->isWindow())
{
    return option->palette.brush(group, role);
}
return Qt::NoBrush;
```

普通子布局落到最后一行，`QPainter::fillRect()` 收到 `Qt::NoBrush` 就跳过填充。这样父面板的像素能一直透到手柄。还有一个容易漏掉的细节。在 Qt 5.15.2 里，`CE_Splitter` 收到的 `widget` 是分隔容器，但 `QPainter` 建在手柄上。修复后，样式从绘图设备取回手柄，用它查询局部画刷。[Qt 的手柄绘制入口](https://github.com/qt/qtbase/blob/v5.15.2/src/widgets/widgets/qsplitter.cpp#L339-L357)

```cpp
const QSplitterHandle *const handle = dynamic_cast<const QSplitterHandle *>(p->device());
const QWidget *const surface = handle ? handle : widget;
```

这样，应用通过 `splitter->handle(1)->setPalette(palette)` 指定的底色也能生效。两侧的边线和中间的握持标记照常绘制，鼠标悬停或拖动时再铺上反馈色。

### 滑轨要跟着哪一层

Qt 5.15.2 的 `QScrollBar` 在初始化时设置 `WA_OpaquePaintEvent`，告诉 Qt 自己会画满每个像素。要让滑轨透出父背景，先得让 Qt 准备好下面那层像素。样式在 `polish()` 中保存旧值，再对滚动条调用 `widget->setAttribute(Qt::WA_OpaquePaintEvent, false)`，卸载样式时恢复旧值。[Qt 的滚动条初始化](https://github.com/qt/qtbase/blob/v5.15.2/src/widgets/widgets/qscrollbar.cpp#L344-L357)

决定滑轨的画刷时，先尊重滚动条本身应绘制的背景；没有就区分独立滚动条和滚动区域自带的滚动条。下例通过父控件层级找滚动区域，再核对它是否真是该区域的横向或纵向滚动条。这是针对 Qt 5.15.2 的实现细节，升级后应重新检查。下面是自定义样式给滑轨和横纵滚动条交角共用的函数。

```cpp
QBrush Style::scrollBackgroundBrush(const QStyleOption *option, const QWidget *widget) const
{
    const QAbstractScrollArea *area = qobject_cast<const QAbstractScrollArea *>(widget);
    if (!area)
    {
        const QBrush explicitBackground = layoutBackgroundBrush(option, widget);
        if (explicitBackground.style() != Qt::NoBrush)
        {
            return explicitBackground;
        }
        const QScrollBar *const bar = qobject_cast<const QScrollBar *>(widget);
        const QWidget *const container = bar ? bar->parentWidget() : nullptr;
        area = container ? qobject_cast<const QAbstractScrollArea *>(container->parentWidget()) : nullptr;
        if (!area || (area->horizontalScrollBar() != bar && area->verticalScrollBar() != bar))
        {
            return Qt::NoBrush;
        }
    }
    const QWidget *const viewport = area->viewport();
    if (viewport->autoFillBackground())
    {
        return viewport->palette().brush(viewport->backgroundRole());
    }
    return Qt::NoBrush;
}
```

画滑轨时，`CC_ScrollBar` 传入滚动条。画右下角的小方块时，`PE_PanelScrollAreaCorner` 传入滚动区域，可以直接走到视口判断。属性面板的视口已经透明，两处都露出父背景。文本编辑器的视口若在填充自己的 `Base`，两处就取视口正在用的画刷。

这里连**颜色组**也要取自视口。单独禁用一根滚动条时，滑块应出现禁用反馈，旁边的编辑区却仍然启用。最后的 `viewport->palette().brush(viewport->backgroundRole())` 让空轨道继续和编辑区同色。

![修复后的 QTimeEdit 页面，属性面板、常态手柄和空滑轨底色连贯，握持标记和滑块可见](/images/qt-widget-background-inheritance/03-inherited-background.png)

*图 3　修复后的同一页面。手柄的两侧边线、中间的握持标记和右侧滑块仍然可见，三处留白已经连成一片。*

## 用另一种底色验收

只在墨蓝色上验收，很容易重演 Fusion 实验的第一行。回归测试用原生 Qt 控件搭起分栏和滚动表单，分别放在浅色 `#d0dade` 和深色 `#27384a` 上。测试抓取整个窗口，把手柄内部、视口、两条空轨道和交角上的点映射到窗口坐标，再按设备像素比取色。只检查 `autoFillBackground()` 会漏掉样式在绘制阶段填回固定色的情形。

还有一个更能检验背景传播的用例。父控件在左右两半分别画上 `#456789` 和 `#987654`，一根原生横向滚动条跨过分界。下面是测试中的像素断言。`pixel()` 从整窗截图取色，坐标相对于传入的手柄或滚动条。

```cpp
QCOMPARE(pixel(root, split->handle(1), QPoint(3, 3)), QColor("#456789"));
QCOMPARE(pixel(root, bar, QPoint(60, 5)), QColor("#456789"));
QCOMPARE(pixel(root, bar, QPoint(360, 5)), QColor("#987654"));
split->move(180, 10);
QCOMPARE(pixel(root, split->handle(1), QPoint(3, 3)), QColor("#987654"));
```

同一条滑轨上的两个点要同时显示两种颜色，移动分隔容器后，手柄还要露出新位置的颜色。即使样式能从调色板里找到某个“看起来对”的颜色，拿它填满整条轨道也通不过这组断言。

最后回到图 1。界面回归测试把表单滚动到底、筛选属性、切换主题色，再打开对话框让属性面板重建。将标签页底色改成 `#365478` 后，面板留白、手柄和空轨道应一起变色，搜索输入框内部仍应是 `#191e28`。这样既能验证该透出的地方确实透出，也能验证该画自己背景的控件仍然照常绘制。

## 排查顺序

1. 色差从滚动表单上沿开始：分别查看 `viewport()` 和 `widget()`，不要把 `NoFrame` 当成透明开关。
2. 只剩手柄或空轨道异色：检查样式是否在绘制阶段又铺了一层，以及滚动条是否仍声明自己不透明。
3. 换用双色或渐变背景再测：如果手柄移动后能显示新位置的颜色，跨分界线的空滑轨也能同时透出两种色，才说明底色确实来自下面的那层。

## 附录：复现四次取色的完整程序

把下面的代码保存为 `FusionBackground.cpp`。它只依赖 Qt Widgets。`sample()` 每次都抓取整个父面板，再把三个取样点映射到截图上。特意把视口的取样点选在 `(120, 60)`，它落在 42 × 32 的内容矩形外，能单独观察视口的填充。

```cpp
#include <QApplication>
#include <QColor>
#include <QImage>
#include <QPainter>
#include <QPixmap>
#include <QScrollArea>
#include <QTextStream>
#include <QWidget>

#include <cstdio>

namespace
{
class Panel final : public QWidget
{
public:
    void enableTint()
    {
        m_tinted = true;
        update();
    }

protected:
    void paintEvent(QPaintEvent *event) override
    {
        QWidget::paintEvent(event);
        if (m_tinted)
        {
            QPainter painter(this);
            painter.fillRect(rect(), QColor("#222733"));
        }
    }

private:
    bool m_tinted = false;
};

void sample(QTextStream &output, const char *stage, QWidget &panel, const QScrollArea &area)
{
    QApplication::processEvents();
    const QPixmap snapshot = panel.grab();
    const QImage image = snapshot.toImage();
    const qreal ratio = snapshot.devicePixelRatioF();
    const auto colorAt = [&panel, &image, ratio](const QWidget *widget, const QPoint &point)
    {
        const QPoint position = widget->mapTo(&panel, point);
        return image.pixelColor(qRound(position.x() * ratio), qRound(position.y() * ratio)).name();
    };
    output << stage << " | " << colorAt(&panel, QPoint(10, 10)) << " | " << colorAt(area.viewport(), QPoint(120, 60))
           << " | " << colorAt(area.widget(), QPoint(5, 5)) << '\n';
}
} // namespace

int main(int argc, char **argv)
{
    QApplication const application(argc, argv);
    QApplication::setStyle(QStringLiteral("Fusion"));
    Panel panel;
    panel.resize(240, 110);
    panel.setAttribute(Qt::WA_DontShowOnScreen);
    QScrollArea area(&panel);
    area.setGeometry(60, 15, 150, 76);
    area.setFrameShape(QFrame::NoFrame);
    QWidget *const content = new QWidget(&area);
    content->resize(42, 32);
    area.setWidget(content);
    panel.show();

    QTextStream output(stdout);
    output << "Stage | panel | viewport | content\n";
    sample(output, "Fusion", panel, area);
    panel.enableTint();
    sample(output, "Paint panel", panel, area);
    area.viewport()->setAutoFillBackground(false);
    sample(output, "Disable viewport fill", panel, area);
    content->setAutoFillBackground(false);
    sample(output, "Disable content fill too", panel, area);
}
```

将以下内容保存为同一目录下的 `CMakeLists.txt`。

```cmake
cmake_minimum_required(VERSION 3.16)
project(FusionBackground LANGUAGES CXX)

find_package(Qt5 5.15 REQUIRED COMPONENTS Widgets)
add_executable(FusionBackground FusionBackground.cpp)
target_compile_features(FusionBackground PRIVATE cxx_std_17)
target_link_libraries(FusionBackground PRIVATE Qt5::Widgets)
```

在已配置 Qt 5.15 和 Ninja 的开发终端里运行以下命令。程序把四次取色输出到终端，每行依次是外层面板、视口和内容的颜色。上表是原实验环境的结果；如果系统调色板不同，优先比较三个位置随操作变化的关系，而不是要求 Fusion 初始值一定是 `#efefef`。

```sh
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/FusionBackground -platform offscreen
```
