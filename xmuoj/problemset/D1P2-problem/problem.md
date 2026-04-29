# D1P2 完美立方

- 范围：题库
- 题型：OI
- 难度：Low
- 语言：C++, Java

## 题目描述

<p><span style="color: rgb(35, 31, 23);">形如a^</span>3<span style="color: rgb(35, 31, 23);">= b^</span>3<span style="color: rgb(35, 31, 23);">+ c^</span>3<span style="color: rgb(35, 31, 23);">+ d^</span>3<span style="color: rgb(35, 31, 23);">的等式被称为完美立方等式。例如12^</span>3<span style="color: rgb(35, 31, 23);">= 6^</span>3<span style="color: rgb(35, 31, 23);">+ 8^</span>3<span style="color: rgb(35, 31, 23);">+ 10^</span>3<span style="color: rgb(35, 31, 23);">。编写一个程序，对任给的正整数N (N≤100)，寻找所有的四元组(a, b, c, d)，使得</span><span style="color: rgb(35, 31, 23);">a^</span>3<span style="color: rgb(35, 31, 23);">= b^</span>3<span style="color: rgb(35, 31, 23);">+ c^</span>3<span style="color: rgb(35, 31, 23);">+ d^</span>3<span style="color: rgb(35, 31, 23);">，其中a,b,c,d 大于 1, 小于等于N，且b&lt;=c&lt;=d。</span><br /></p>

## 输入描述

<p><span style="color: rgb(35, 31, 23);">一个正整数N (N≤100)。</span><br /></p>

## 输出描述

<p><span style="color: rgb(35, 31, 23);">每行输出一个完美立方。输出格式为：</span></p><p><span style="color: rgb(35, 31, 23);">Cube = a, Triple = (b,c,d)</span></p><p><span style="color: rgb(35, 31, 23);">其中a,b,c,d所在位置分别用实际求出四元组值代入。</span></p><p><span style="color: rgb(35, 31, 23);">请按照a的值，从小到大依次输出。当两个完美立方等式中a的值相同，则b值小的优先输出、仍相同则c值小的优先输出、再相同则d值小的先输出。</span></p>

## 样例

### 样例 1

#### 输入

```text
24
```

#### 输出

```text
Cube = 6, Triple = (3,4,5)
Cube = 12, Triple = (6,8,10)
Cube = 18, Triple = (2,12,16)
Cube = 18, Triple = (9,12,15)
Cube = 19, Triple = (3,10,18)
Cube = 20, Triple = (7,14,17)
Cube = 24, Triple = (12,16,20)
```

## 提示

<p><a href="https://www.bilibili.com/video/bv1Nb4y1C7NJ" target="_blank">Andy讲解(2021)</a><br /></p>
