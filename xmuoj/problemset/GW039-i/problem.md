# GW039 编程填空：左边i位取反

- 范围：题库
- 题型：OI
- 难度：Low
- 语言：C++

## 题目描述

<p>写出函数中缺失的部分，使得函数返回值为一个整数,该整数的左边i位是n的左边i位取反，其余位和n相同</p><p>请使用【<strong>一行代码</strong>】补全bitManipulation3函数使得程序能达到上述的功能<br /></p><pre>#include &lt;iostream&gt;
using namespace std;

int bitManipulation3(int n, int i) {</pre><pre>// 在此处补充你的代码</pre><pre>}

int main() {
	int t, n, i;
	cin &gt;&gt; t;
	while (t--) {
		cin &gt;&gt; n &gt;&gt; i;
		cout &lt;&lt; bitManipulation3(n, i) &lt;&lt; endl;
	}
	return 0;
}</pre>

## 输入描述

<p><span style="color: rgb(35, 31, 23);">第一行是整数 t，表示测试组数。</span></p><p><span style="color: rgb(35, 31, 23);">每组测试数据包含一行，是两个整数 n 和 i (1&lt;=i&lt;=32)。</span></p>

## 输出描述

<p><span style="color: rgb(35, 31, 23);">对每组输入数据，输出整型变量n中左边i位取反的结果。</span><br /></p>

## 样例

### 样例 1

#### 输入

```text
1
0 32
```

#### 输出

```text
-1
```

## 提示

<p><span style="color: rgb(35, 31, 23);">注意i从1开始</span><br /></p>
