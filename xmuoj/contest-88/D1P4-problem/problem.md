# D1P4 假币问题

- 比赛：《算法基础与在线编程实验教程》配套题库(1)
- 题型：OI
- 难度：Low
- 语言：C++, Java

## 题目描述

<p>林克有12枚银币。其中有11枚真币和1枚假币。假币看起来和真币没有区别，但是重量不同。但林克不知道假币比真币轻还是重。</p><p>于是他向他朋友约珥借了一架天平，用这架天平称了这些币三次。</p><p><span style="color: rgb(35, 31, 23);">如果用天平称两枚硬币，发现天平平衡，说明两枚都是真的。</span><span style="color: rgb(35, 31, 23);">如果用一枚真币与另一枚银币比较，发现它比真币轻或重，说明它是假币。</span></p><p>经过精心的设计，聪明的林克根据这三次称量结果找出假币，并且能够确定假币是轻是重。<br /></p><p>如果给你林克的称量数据，你也可以找出假币并且确定假币是轻是重吗？（林克提供的称量数据保证一定能找出假币）。</p>

## 输入描述

<p><span style="color: rgb(35, 31, 23);">第一行有一个数字n，表示有n组测试用例。</span></p><p><span style="color: rgb(35, 31, 23);">对于每组测试用例：</span></p><p><span style="color: rgb(35, 31, 23);">输入有三行，每行表示一次称量的结果。林克事先将银币标号为A-L。</span></p><p><span style="color: rgb(35, 31, 23);">每次称量的结果用三个以空格隔开的字符串表示：</span></p><p><span style="color: rgb(35, 31, 23);">天平左边放置的硬币  天平右边放置的硬币  平衡状态。</span></p><p><span style="color: rgb(35, 31, 23);">其中平衡状态用``up&#039;&#039;, ``down&#039;&#039;, 或 ``even&#039;&#039;表示, 分别为右端高、右端低和平衡。天平左右的硬币数总是相等的。</span></p>

## 输出描述

<p><span style="color: rgb(35, 31, 23);">输出哪一个标号的银币是假币，并说明它比真币轻还是重(heavy or light)。</span><br /></p><p><font>每组案例的输出占一行。</font></p>

## 样例

### 样例 1

#### 输入

```text
1
ABCD EFGH even 
ABCI EFJK up 
ABIJ EFGH even 
```

#### 输出

```text
K is the counterfeit coin and it is light. 

```

## 提示

<p><a href="https://www.bilibili.com/video/BV1kM4y1u71y" target="_blank">Andy讲解(2021)</a><br /></p>
