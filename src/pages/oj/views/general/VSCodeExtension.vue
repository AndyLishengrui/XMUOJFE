<template>
  <main class="extension-page">
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow"><span class="status-dot"></span> 官方插件 · 最新 0.1.6</div>
        <h1>把 XMUOJ<br><span>装进 VS Code</span></h1>
        <p class="lead">浏览题目、编写代码、本地测试与提交，全流程不离开编辑器。</p>
        <div class="hero-actions">
          <a class="download-button" :href="downloadUrl" download>
            <Icon type="download"></Icon>
            <span>下载 VSIX</span>
            <small>v0.1.6</small>
          </a>
          <button type="button" class="guide-button" @click="scrollToInstall">
            安装教程
            <Icon type="ios-arrow-down"></Icon>
          </button>
        </div>
        <div class="compatibility">
          <span>支持 VS Code / Cursor / Trae</span>
          <span>需要 XMUOJ 账号</span>
        </div>
      </div>

      <div class="hero-demo" aria-label="插件界面演示">
        <div class="window-glow glow-one"></div>
        <div class="window-glow glow-two"></div>
        <div class="editor-window">
          <div class="window-bar">
            <div class="traffic"><span></span><span></span><span></span></div>
            <div class="window-tab"><span class="cpp-icon">C++</span> 熄灯问题.cpp</div>
          </div>
          <div class="window-body">
            <aside class="activity-bar">
              <span class="activity active">▦</span>
              <span class="activity">⌕</span>
              <span class="activity">⑂</span>
              <span class="activity">◎</span>
            </aside>
            <aside class="problem-panel">
              <div class="panel-heading">
                <span>XMUOJ</span>
                <span class="panel-menu">···</span>
              </div>
              <div class="problem-title">熄灯问题</div>
              <div class="problem-meta"><span>1338</span><span>入门</span></div>
              <div class="problem-section">题目描述</div>
              <div class="skeleton-lines">
                <i></i><i></i><i></i>
              </div>
              <div class="problem-section">样例输入 / 输出</div>
              <div class="sample-boxes">
                <div><b>输入</b><code>1 1<br>0 0</code></div>
                <div><b>输出</b><code>0</code></div>
              </div>
            </aside>
            <section class="code-panel">
              <div class="breadcrumbs">problems <span>›</span> main.cpp</div>
              <div class="code-lines">
                <div><span>1</span><code><em>#include</em> &lt;bits/stdc++.h&gt;</code></div>
                <div><span>2</span><code><em>using namespace</em> std;</code></div>
                <div><span>3</span><code></code></div>
                <div><span>4</span><code><b>int</b> main() &#123;</code></div>
                <div><span>5</span><code>&nbsp;&nbsp;<b>int</b> n, m;</code></div>
                <div><span>6</span><code>&nbsp;&nbsp;cin &gt;&gt; n &gt;&gt; m;</code></div>
                <div class="cursor-line"><span>7</span><code>&nbsp;&nbsp;solve(n, m);</code><i class="caret"></i></div>
              </div>
              <div class="status-bar">
                <span>⑂ main.cpp</span>
                <span class="ac-status">✓ 本地测试通过</span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>

    <section class="feature-strip">
      <article>
        <div class="feature-icon">01</div>
        <div>
          <h3>沉浸式刷题</h3>
          <p>题面与代码并排，长时间编码也不打断思路。</p>
        </div>
      </article>
      <article>
        <div class="feature-icon">02</div>
        <div>
          <h3>一键本地测试</h3>
          <p>自动读取题目数据，快速验证每一个提交。</p>
        </div>
      </article>
      <article>
        <div class="feature-icon">03</div>
        <div>
          <h3>连接 XMUOJ</h3>
          <p>题库、提交记录与刷题进度始终保持同步。</p>
        </div>
      </article>
    </section>

    <section class="workflow" ref="workflow">
      <div class="section-heading">
        <span>使用方式</span>
        <h2>从打开题目到提交完成</h2>
        <p>三个步骤，专注算法本身。</p>
      </div>
      <div class="workflow-grid">
        <article class="workflow-card">
          <div class="step-number">01</div>
          <div class="mini-window install-window">
            <div class="mini-top"><span></span><span></span><span></span></div>
            <div class="extension-search"><Icon type="search"></Icon> XMUOJ</div>
            <div class="extension-result">
              <div class="x-icon">X</div>
              <div><b>XMUOJ</b><small>在 VS Code 中刷题</small></div>
              <i>下载</i>
            </div>
          </div>
          <h3>安装插件</h3>
          <p>下载 VSIX，在扩展面板选择“从 VSIX 安装”。</p>
        </article>
        <article class="workflow-card featured">
          <div class="step-number">02</div>
          <div class="mini-window login-window">
            <div class="mini-top"><span></span><span></span><span></span></div>
            <div class="login-card">
              <div class="login-logo">X</div>
              <b>连接 XMUOJ</b>
              <i></i>
              <i></i>
              <button>登录账号</button>
            </div>
          </div>
          <h3>登录并选择题目</h3>
          <p>登录 XMUOJ，搜索题目或打开题库中的题目。</p>
        </article>
        <article class="workflow-card">
          <div class="step-number">03</div>
          <div class="mini-window test-window">
            <div class="mini-top"><span></span><span></span><span></span></div>
            <div class="test-row"><b>本地测试</b><span>running...</span></div>
            <div class="test-case"><i>✓</i><span>样例 1</span><b>通过</b></div>
            <div class="test-case"><i>✓</i><span>样例 2</span><b>通过</b></div>
            <div class="submit-progress"><span></span></div>
          </div>
          <h3>测试并提交</h3>
          <p>本地验证后提交代码，在编辑器中查看评测结果。</p>
        </article>
      </div>
    </section>

    <section class="install-guide" id="install-guide">
      <div class="guide-copy">
        <span class="guide-label">快速安装</span>
        <h2>一分钟装好插件</h2>
      </div>
      <ol class="install-steps">
        <li>
          <span>1</span>
          <div>
            <h3>下载插件包</h3>
            <p>点击页面上方的“下载 VSIX”，保存插件安装包。</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <h3>安装 VSIX</h3>
            <p>打开扩展面板，选择“从 VSIX 安装”，再选择下载的文件。</p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <h3>打开 XMUOJ</h3>
            <p>按快捷键 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>，执行“XMUOJ: 快速开始”。</p>
          </div>
        </li>
      </ol>
      <a class="guide-download" :href="downloadUrl" download>
        <Icon type="download"></Icon>
        下载 v0.1.6
      </a>
    </section>
  </main>
</template>

<script>
  export default {
    name: 'vscode-extension',
    data () {
      return {
        downloadUrl: '/downloads/xmuoj-vscode-0.1.6.vsix'
      }
    },
    mounted () {
      window.scrollTo(0, 0)
    },
    methods: {
      scrollToInstall () {
        const guide = document.getElementById('install-guide')
        if (guide) {
          guide.scrollIntoView({behavior: 'smooth', block: 'start'})
        }
      }
    }
  }
</script>

<style lang="less" scoped>
  @ink: #0b1020;
  @blue: #5b7cfa;
  @violet: #8b5cf6;
  @muted: #667085;

  .extension-page {
    margin: -80px -2% 0;
    overflow: hidden;
    color: @ink;
    background: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  }

  .hero {
    min-height: 680px;
    display: grid;
    grid-template-columns: 42% 58%;
    align-items: center;
    max-width: 1440px;
    margin: 0 auto;
    padding: 70px 5% 60px;
    background-image:
      radial-gradient(circle at 82% 20%, rgba(91, 124, 250, .12), transparent 24%),
      radial-gradient(circle at 14% 82%, rgba(139, 92, 246, .08), transparent 20%);
  }
  .hero-copy { position: relative; z-index: 3; }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 24px;
    padding: 7px 12px;
    border: 1px solid #e4e8f0;
    border-radius: 999px;
    color: #596175;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: .02em;
    background: rgba(255,255,255,.8);
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #37b779;
    box-shadow: 0 0 0 4px rgba(55,183,121,.12);
  }
  h1 {
    margin: 0;
    font-size: 64px;
    line-height: 1.06;
    letter-spacing: -4px;
    font-weight: 800;
  }
  h1 span {
    background: linear-gradient(90deg, @blue, @violet);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .lead {
    max-width: 480px;
    margin: 24px 0 30px;
    color: @muted;
    font-size: 20px;
    line-height: 1.7;
  }
  .hero-actions { display: flex; gap: 12px; align-items: center; }
  .download-button {
    min-width: 210px;
    height: 58px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border-radius: 12px;
    color: #fff;
    background: linear-gradient(135deg, #5575f5, #7456df);
    box-shadow: 0 14px 32px rgba(91,124,250,.28);
    font-size: 16px;
    font-weight: 700;
    transition: transform .2s, box-shadow .2s;
  }
  .download-button:hover { transform: translateY(-2px); box-shadow: 0 18px 38px rgba(91,124,250,.34); }
  .download-button small {
    margin-left: 2px;
    padding-left: 9px;
    border-left: 1px solid rgba(255,255,255,.28);
    font-size: 12px;
    opacity: .78;
  }
  .guide-button {
    height: 58px;
    padding: 0 20px;
    border: 1px solid #dde2ea;
    border-radius: 12px;
    background: #fff;
    color: #344054;
    cursor: pointer;
    font-size: 15px;
    font-weight: 700;
  }
  .compatibility { margin-top: 18px; display: flex; gap: 18px; color: #8a93a3; font-size: 12px; }
  .compatibility span::before { content: '✓'; margin-right: 5px; color: #37b779; }

  .hero-demo { position: relative; min-width: 0; perspective: 1200px; }
  .window-glow { position: absolute; border-radius: 50%; filter: blur(20px); }
  .glow-one { width: 250px; height: 250px; right: 6%; top: 0; background: rgba(91,124,250,.18); }
  .glow-two { width: 220px; height: 220px; left: 12%; bottom: -5%; background: rgba(139,92,246,.12); }
  .editor-window {
    position: relative;
    height: 440px;
    margin-left: 20px;
    border: 1px solid rgba(80,94,130,.18);
    border-radius: 16px;
    overflow: hidden;
    background: #101522;
    box-shadow: 0 30px 70px rgba(41,50,84,.24), 0 8px 24px rgba(41,50,84,.12);
    transform: rotateY(-2deg) rotateX(1deg);
  }
  .window-bar { height: 44px; display: flex; align-items: center; background: #171c29; border-bottom: 1px solid rgba(255,255,255,.06); }
  .traffic { display: flex; gap: 6px; margin-left: 15px; }
  .traffic span { width: 9px; height: 9px; border-radius: 50%; background: #697087; }
  .traffic span:first-child { background: #fb7185; }
  .traffic span:nth-child(2) { background: #fbbf24; }
  .traffic span:nth-child(3) { background: #34d399; }
  .window-tab { height: 44px; margin-left: 20px; padding: 0 16px; display: flex; align-items: center; gap: 8px; color: #d7deed; background: #101522; border-left: 1px solid rgba(255,255,255,.05); border-right: 1px solid rgba(255,255,255,.05); font-size: 12px; }
  .cpp-icon { color: #7ea7ff; font-weight: 800; font-size: 10px; }
  .window-body { height: 396px; display: grid; grid-template-columns: 44px 220px 1fr; }
  .activity-bar { padding-top: 12px; display: flex; flex-direction: column; align-items: center; gap: 18px; border-right: 1px solid rgba(255,255,255,.05); color: #78819a; }
  .activity { width: 44px; text-align: center; font-size: 17px; }
  .activity.active { color: #9ab4ff; border-left: 2px solid #7898ff; }
  .problem-panel { padding: 14px; border-right: 1px solid rgba(255,255,255,.06); color: #cbd4e7; background: #151a27; }
  .panel-heading { height: 30px; display: flex; justify-content: space-between; color: #7f899e; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
  .panel-menu { font-size: 16px; }
  .problem-title { font-size: 16px; font-weight: 700; color: #eef3ff; }
  .problem-meta { display: flex; gap: 6px; margin: 8px 0 18px; }
  .problem-meta span { padding: 3px 7px; border-radius: 4px; background: rgba(126,167,255,.1); color: #8faeff; font-size: 9px; }
  .problem-section { margin: 13px 0 8px; color: #eff4ff; font-size: 11px; font-weight: 700; }
  .skeleton-lines { display: flex; flex-direction: column; gap: 6px; }
  .skeleton-lines i { height: 6px; border-radius: 4px; background: rgba(180,194,224,.12); }
  .skeleton-lines i:nth-child(2) { width: 82%; }
  .skeleton-lines i:nth-child(3) { width: 58%; }
  .sample-boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .sample-boxes div { min-height: 64px; padding: 8px; border: 1px solid rgba(255,255,255,.07); border-radius: 6px; color: #8994aa; font-size: 9px; }
  .sample-boxes code { display: block; margin-top: 7px; color: #dfe7f6; font-family: monospace; font-size: 10px; }
  .code-panel { position: relative; overflow: hidden; color: #c7d0e3; background: #101522; }
  .breadcrumbs { height: 31px; padding: 9px 18px 0; color: #69748a; border-bottom: 1px solid rgba(255,255,255,.04); font-size: 10px; }
  .breadcrumbs span { margin: 0 5px; }
  .code-lines { padding-top: 16px; font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; line-height: 25px; }
  .code-lines div { display: grid; grid-template-columns: 38px 1fr; }
  .code-lines div > span { color: #566176; text-align: right; padding-right: 12px; }
  .code-lines code { color: #bdc8dc; }
  .code-lines em { color: #c38cff; font-style: normal; }
  .code-lines b { color: #6fb3ff; font-weight: 600; }
  .cursor-line { position: relative; background: rgba(91,124,250,.055); animation: cursorGlow 2.2s ease-in-out infinite; }
  .caret { position: absolute; left: 155px; top: 5px; width: 2px; height: 16px; background: #d7e1ff; animation: blink 1.1s steps(1) infinite; }
  .status-bar { position: absolute; right: 0; bottom: 0; left: 0; height: 25px; padding: 5px 10px; display: flex; justify-content: space-between; color: #8190aa; background: #171c29; font-size: 9px; }
  .ac-status { color: #70d7a8; }

  @keyframes blink { 50% { opacity: 0; } }
  @keyframes cursorGlow { 0%,100% { box-shadow: inset 0 0 0 rgba(91,124,250,0); } 50% { box-shadow: inset 0 0 18px rgba(91,124,250,.08); } }

  .feature-strip {
    max-width: 1280px;
    margin: 0 auto 100px;
    padding: 28px 34px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border: 1px solid #edf0f4;
    border-radius: 18px;
    box-shadow: 0 18px 50px rgba(37,44,72,.07);
  }
  .feature-strip article { display: flex; align-items: flex-start; gap: 14px; padding: 4px 28px; }
  .feature-strip article + article { border-left: 1px solid #edf0f4; }
  .feature-icon { flex: 0 0 auto; width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; background: #f1f4ff; color: #657fdb; font-size: 12px; font-weight: 800; }
  .feature-strip h3 { margin: 1px 0 5px; font-size: 16px; }
  .feature-strip p { margin: 0; color: @muted; font-size: 13px; line-height: 1.6; }

  .workflow { padding: 90px 5% 110px; background: #f7f8fb; }
  .section-heading { text-align: center; margin-bottom: 42px; }
  .section-heading > span { color: @blue; font-size: 12px; font-weight: 800; letter-spacing: .18em; }
  .section-heading h2 { margin: 12px 0 8px; font-size: 38px; letter-spacing: -1.5px; }
  .section-heading p { margin: 0; color: @muted; }
  .workflow-grid { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .workflow-card { position: relative; padding: 30px 28px 28px; border: 1px solid #e9ecf2; border-radius: 18px; background: #fff; box-shadow: 0 12px 36px rgba(37,44,72,.055); }
  .workflow-card.featured { transform: translateY(-12px); border-color: rgba(91,124,250,.22); box-shadow: 0 20px 44px rgba(91,124,250,.11); }
  .step-number { position: absolute; top: 18px; right: 20px; color: #cbd2df; font-size: 12px; font-weight: 800; }
  .workflow-card h3 { margin: 22px 0 7px; font-size: 18px; }
  .workflow-card > p { margin: 0; color: @muted; font-size: 13px; line-height: 1.65; }
  .mini-window { height: 220px; border-radius: 12px; overflow: hidden; border: 1px solid #e1e5ec; background: #fbfcfe; box-shadow: inset 0 1px 0 #fff; }
  .mini-top { height: 28px; display: flex; align-items: center; gap: 5px; padding-left: 10px; background: #eef1f6; }
  .mini-top span { width: 7px; height: 7px; border-radius: 50%; background: #b5bcc8; }
  .extension-search { width: calc(100% - 28px); height: 34px; margin: 18px 14px 10px; padding: 8px 10px; border: 1px solid #dfe4ec; border-radius: 7px; color: #8a94a4; font-size: 11px; }
  .extension-result { height: 72px; margin: 0 14px; padding: 12px; display: grid; grid-template-columns: 42px 1fr 42px; align-items: center; border-radius: 8px; background: #fff; box-shadow: 0 8px 20px rgba(37,44,72,.08); }
  .x-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 9px; color: #fff; background: linear-gradient(135deg,#6d8cff,#7656dc); font-weight: 800; }
  .extension-result b { display: block; font-size: 12px; }
  .extension-result small { display: block; margin-top: 3px; color: #8a94a4; font-size: 9px; }
  .extension-result i { padding: 5px 7px; border-radius: 5px; color: #fff; background: #5b7cfa; font-size: 9px; font-style: normal; text-align: center; }
  .login-window { display: flex; flex-direction: column; }
  .login-card { width: 170px; height: 155px; margin: 18px auto; padding: 14px; display: flex; flex-direction: column; align-items: center; border-radius: 9px; background: #fff; box-shadow: 0 10px 26px rgba(37,44,72,.09); }
  .login-logo { width: 38px; height: 38px; margin-bottom: 7px; display: grid; place-items: center; border-radius: 10px; color: #fff; background: #667eea; font-weight: 800; }
  .login-card b { font-size: 11px; }
  .login-card i { width: 120px; height: 14px; margin-top: 8px; border-radius: 4px; background: #f0f2f6; }
  .login-card button { width: 120px; height: 28px; margin-top: 9px; border: 0; border-radius: 5px; color: #fff; background: #667eea; font-size: 9px; }
  .test-window { padding-bottom: 12px; }
  .test-row { height: 52px; margin: 14px 14px 7px; padding: 0 10px; display: flex; align-items: center; justify-content: space-between; border-radius: 7px; border: 1px solid #e9ecf2; font-size: 11px; }
  .test-row span { color: #8b92a2; font-size: 9px; animation: pulse 1.6s infinite; }
  .test-case { height: 36px; margin: 0 14px 6px; padding: 0 10px; display: grid; grid-template-columns: 20px 1fr 32px; align-items: center; border-radius: 6px; background: #f5f7fa; font-size: 10px; }
  .test-case i { color: #36b778; font-style: normal; }
  .test-case b { color: #36b778; font-size: 9px; }
  .submit-progress { height: 4px; margin: 14px 14px 0; border-radius: 99px; background: #edf0f4; overflow: hidden; }
  .submit-progress span { display: block; width: 72%; height: 100%; border-radius: inherit; background: linear-gradient(90deg,#5b7cfa,#37b779); animation: progress 3s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .45; } }
  @keyframes progress { 0% { width: 8%; } 60%,100% { width: 100%; } }

  .install-guide {
    max-width: 1180px;
    min-height: 340px;
    margin: 90px auto 110px;
    padding: 44px;
    display: grid;
    grid-template-columns: 250px 1fr 180px;
    align-items: center;
    gap: 40px;
    border-radius: 22px;
    color: #fff;
    background: linear-gradient(135deg,#111827,#202b4a 70%,#30416a);
    box-shadow: 0 24px 60px rgba(31,41,69,.18);
  }
  .guide-label { color: #a9baff; font-size: 12px; font-weight: 800; letter-spacing: .16em; }
  .guide-copy h2 { margin: 10px 0 0; font-size: 34px; letter-spacing: -1px; }
  .install-steps { margin: 0; padding: 0; list-style: none; }
  .install-steps li { display: grid; grid-template-columns: 38px 1fr; gap: 12px; padding: 10px 0; }
  .install-steps li > span { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; border: 1px solid rgba(255,255,255,.18); color: #cdd7ff; font-size: 12px; }
  .install-steps h3 { margin: 0 0 4px; font-size: 15px; }
  .install-steps p { margin: 0; color: #bbc6dc; font-size: 12px; line-height: 1.6; }
  kbd { padding: 2px 5px; border-radius: 4px; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.08); font-family: inherit; }
  .guide-download { height: 46px; display: flex; align-items: center; justify-content: center; gap: 7px; border-radius: 10px; color: #fff; background: #617bf0; font-size: 13px; font-weight: 700; }

  @media screen and (max-width: 1200px) {
    .extension-page { margin: -160px -2% 0; }
    .hero { grid-template-columns: 42% 58%; padding-top: 110px; }
    h1 { font-size: 52px; }
    .window-body { grid-template-columns: 44px 190px 1fr; }
    .feature-strip { margin-left: 2%; margin-right: 2%; }
  }
  @media screen and (max-width: 900px) {
    .hero { grid-template-columns: 1fr; padding: 110px 6% 40px; text-align: center; }
    .hero-copy { margin-bottom: 40px; }
    .lead { margin-left: auto; margin-right: auto; }
    .hero-actions, .compatibility { justify-content: center; }
    .editor-window { max-width: 680px; margin: 0 auto; }
    .feature-strip { grid-template-columns: 1fr; }
    .feature-strip article + article { margin-top: 18px; padding-top: 18px; border-left: 0; border-top: 1px solid #edf0f4; }
    .workflow-grid { grid-template-columns: 1fr; max-width: 500px; }
    .workflow-card.featured { transform: none; }
    .install-guide { margin-left: 4%; margin-right: 4%; grid-template-columns: 1fr; text-align: center; }
    .install-steps { max-width: 520px; margin: 0 auto; text-align: left; }
  }
  @media screen and (max-width: 600px) {
    h1 { font-size: 42px; letter-spacing: -2px; }
    .hero-actions { flex-direction: column; }
    .download-button, .guide-button { width: 100%; }
    .compatibility { flex-direction: column; gap: 6px; }
    .hero-demo { display: none; }
    .feature-strip { margin-bottom: 60px; }
    .workflow { padding-top: 70px; }
    .section-heading h2 { font-size: 30px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .caret, .cursor-line, .test-row span, .submit-progress span { animation: none; }
  }
</style>
