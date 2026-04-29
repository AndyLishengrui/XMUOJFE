# D1P3 人的周期

- 比赛：《算法基础与在线编程实验教程》配套题库(1)
- 题型：OI
- 难度：Low
- 语言：C++, Java

## 题目描述

<p><span style="color: rgb(35, 31, 23);">据说人生来就有三个生理周期，分别为体力周期、感情周期和智力周期，它们的周期长度分别为23天、28天和33天。</span></p><p><span style="color: rgb(35, 31, 23);">每一个周期中有一天是高峰。在高峰这天，人会在相应的方面表现出色。</span><span style="color: rgb(35, 31, 23);">例如，在智力周期的高峰，人会思维敏捷，注意力容易高度集中。</span></p><p><span style="color: rgb(35, 31, 23);">因为三个周期的长度不同，所以通常三个周期的高峰不会落在同一天。</span></p><p><span style="color: rgb(35, 31, 23);">对于每个人，想知道何时三个高峰落在同一天。</span></p><p><span style="color: rgb(35, 31, 23);">对于每个周期，会给出从当前年份的第一天开始，到出现高峰的天数（不一定是第一次高峰出现的时间）。</span></p><p><span style="color: rgb(35, 31, 23);">给定一个从当年第一天开始的天数，你的任务是输出从给定时间开始（不包括给定时间），下一次三个高峰落在同一天的时间（距给定时间的天数）。例如：给定时间为10，下次出现三个高峰同一天的时间是12，则输出2（注意这里不是3）。</span></p>

## 输入描述

<p><span style="color: rgb(35, 31, 23);">输入包含多组数据，每一组数据由四个整数组成，数据以-1 -1 -1 -1 结束。</span></p><p><span style="color: rgb(35, 31, 23);">对于每一行的四个整数p, e, i和d, 其中p, e, i分别表示体力、情感和智力高峰出现的时间（时间从当年的第一天开始计算）。</span></p><p><span style="color: rgb(35, 31, 23);">d是给定的时间，可能小于p, e或i。所有给定时间是非负的并且小于或等于365，所求的时间小于或等于21252。</span></p>

## 输出描述

<p><span style="color: rgb(35, 31, 23);">从给定时间起，下一次三个高峰同一天的时间（距离给定时间的天数）。</span><br /></p>

## 样例

### 样例 1

#### 输入

```text
0 0 0 0
0 0 0 100
5 20 34 325
4 5 6 7
283 102 23 320
203 301 203 40
-1 -1 -1 -1
```

#### 输出

```text
Case 1: the next triple peak occurs in 21252 days.
Case 2: the next triple peak occurs in 21152 days.
Case 3: the next triple peak occurs in 19575 days.
Case 4: the next triple peak occurs in 16994 days.
Case 5: the next triple peak occurs in 8910 days.
Case 6: the next triple peak occurs in 10789 days.
```

## 提示

<p><a href="https://www.bilibili.com/video/BV1yo4y1k7kD" target="_blank">Andy讲解(2021)</a><br /></p>
