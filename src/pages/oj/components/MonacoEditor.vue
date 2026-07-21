<template>
  <div style="margin: 0px 0px 15px 0px">
    <Row type="flex" justify="space-between" class="header">
      <Col :span=12>
      <div>
        <span>{{$t('m.Language')}}:</span>
        <Select :value="language" @on-change="onLangChange" class="adjust">
          <Option v-for="item in filteredLanguages" :key="item" :value="item">{{item}}
          </Option>
        </Select>

        <Tooltip :content="this.$i18n.t('m.Reset_to_default_code_definition')" placement="top" style="margin-left: 10px">
          <Button icon="refresh" @click="onResetClick"></Button>
        </Tooltip>

        <Tooltip :content="this.$i18n.t('m.Upload_file')" placement="top" style="margin-left: 10px">
          <Button icon="upload" @click="onUploadFile"></Button>
        </Tooltip>

        <Tooltip :content="'编辑器设置'" placement="top" style="margin-left: 10px">
          <Button icon="gear-b" @click="settingsVisible = true"></Button>
        </Tooltip>

        <input type="file" id="file-uploader" style="display: none" @change="onUploadFileDone">

      </div>
      </Col>
      <Col :span=12>
      <div class="fl-right">
        <span>{{$t('m.Theme')}}:</span>
        <Select :value="theme" @on-change="onThemeChange" class="adjust">
          <Option v-for="item in themes" :key="item.label" :value="item.value">{{item.label}}
          </Option>
        </Select>
      </div>
      </Col>
    </Row>
    <div ref="editorContainer" class="monaco-container"></div>

    <!-- Action Bar -->
    <div class="action-bar">
      <div class="action-left"></div>
      <div class="action-right"></div>
    </div>

    <!-- Debug Panel -->
    <div v-if="debugVisible" class="debug-panel">
      <div class="debug-header">
        <div class="debug-title">代码运行状态: {{ debugStatus }}</div>
        <Button icon="close" size="small" @click="debugVisible = false"></Button>
      </div>
      <div class="debug-body">
        <div class="debug-section">
          <div class="debug-label">输入</div>
          <Input v-model="debugInput" type="textarea" :rows="5" placeholder="请输入测试数据" />
        </div>
        <div class="debug-section">
          <div class="debug-label">输出</div>
          <div class="debug-output">
            <pre>{{ debugOutput }}</pre>
          </div>
          <div v-if="debugTimeCost" class="debug-meta">
            运行时间: {{ debugTimeCost }}ms
          </div>
        </div>
      </div>
    </div>

    <!-- Settings Modal -->
    <Modal v-model="settingsVisible" title="代码编辑器设置" width="400">
      <Form :label-width="100">
        <FormItem label="界面风格">
          <Select v-model="theme" @on-change="onThemeChange">
            <Option v-for="item in themes" :key="item.value" :value="item.value">{{ item.label }}</Option>
          </Select>
        </FormItem>
        <FormItem label="编辑类型">
          <Select v-model="keymap">
            <Option value="standard">Standard</Option>
            <Option value="vim">Vim</Option>
            <Option value="emacs">Emacs</Option>
          </Select>
        </FormItem>
        <FormItem label="缩进长度">
          <Select v-model="tabSize" @on-change="onTabSizeChange">
            <Option :value="2">2 个空格</Option>
            <Option :value="4">4 个空格</Option>
            <Option :value="8">8 个空格</Option>
          </Select>
        </FormItem>
        <FormItem label="字体大小">
          <Select v-model="fontSize" @on-change="onFontSizeChange">
            <Option v-for="size in fontSizes" :key="size" :value="size">{{ size }}px</Option>
          </Select>
        </FormItem>
        <FormItem label="代码补全">
          <Select v-model="completion" @on-change="onCompletionChange">
            <Option value="basic">基础补全</Option>
            <Option value="advanced">智能补全</Option>
            <Option value="off">关闭</Option>
          </Select>
        </FormItem>
      </Form>
      <div slot="footer">
        <Button type="primary" @click="settingsVisible = false">确定</Button>
      </div>
    </Modal>
  </div>
</template>
<script>
  import utils from '@/utils/utils'
  import templateData from '@/utils/acwing_templates.json'

  // Monaco is loaded via <script> tag in index.html (UMD build)
  // window.monaco is available globally

  // Register C++ template completion (once)
  let cppCompletionRegistered = false
  // Runtime toggle: can be disabled per-problem (exam) or globally (localStorage)
  let templateCompletionLocallyEnabled = true
  // Completion mode: 'advanced' = templates + built-in, 'basic'/'off' = no templates
  let completionMode = 'advanced'
  const TEMPLATE_STORAGE_KEY = 'xmuoj_disable_template_completion'

  // Check if template completion should be active right now
  function isTemplateCompletionEnabled () {
    if (!templateCompletionLocallyEnabled) return false
    if (localStorage.getItem(TEMPLATE_STORAGE_KEY) === '1') return false
    if (completionMode !== 'advanced') return false
    return true
  }

  // Extract function name from C++ code snippet.
  // Handles: void fn(...), int fn(...), vector<int> fn(...), bool fn(...), etc.
  function extractFunctionName (code) {
    // Match function definitions: [return_type] function_name ( params ) {
    const m = code.match(/(?:^|\n)\s*(?:[\w:]+(?:<[^>]*>)?\s+)+\*?(\w+)\s*\(/)
    if (m) return m[1]
    return null
  }

  // Common function names that are too generic — never use as primary triggers
  const GENERIC_NAMES = new Set([
    'check', 'find', 'insert', 'init', 'remove', 'add', 'sub', 'mul', 'div',
    'get', 'set', 'query', 'size', 'empty', 'clear', 'swap', 'merge', 'dfs'
  ])

  function registerCppTemplateCompletion () {
    if (cppCompletionRegistered) return
    cppCompletionRegistered = true

    // Build template index: extract triggers from code + heading
    const templates = templateData.map(t => {
      const fnName = extractFunctionName(t.code)
      // Algorithm name: heading text before "——"
      const algoName = t.heading.replace(/——.*$/, '').replace(/模板/g, '').replace(/算法/g, '').trim()

      // Build searchable triggers
      const triggers = []

      // Primary trigger: function name (if unique enough)
      if (fnName && !GENERIC_NAMES.has(fnName)) {
        triggers.push({ text: fnName, priority: 100, type: 'function' })
      }

      // Also add generic function names as low-priority triggers
      if (fnName && GENERIC_NAMES.has(fnName)) {
        triggers.push({ text: fnName, priority: 25, type: 'generic-fn' })
      }

      // Extract English algorithm names from heading (e.g., "KMP", "Trie", "Dijkstra", "SPFA", "Floyd")
      const englishAlgos = algoName.match(/[a-zA-Z_]\w*/g) || []
      for (const w of englishAlgos) {
        if (w !== fnName && w.length >= 2 && !/^(AcWing)$/i.test(w)) {
          triggers.push({ text: w, priority: 60, type: 'algo-en' })
        }
      }

      // Full algorithm name as low-priority fallback
      triggers.push({ text: algoName, priority: 5, type: 'algo-full' })

      // Curated signature triggers (ACWing-style: "return type + name prefix",
      // e.g. "vector<int> add", "void mer", "int dij"). Kept separate from
      // `triggers` — they contain spaces and only participate in signature
      // matching, never bare-word matching (typing "int" must not fire them).
      const curated = t.triggers || []

      return { heading: t.heading, code: t.code, fnName, algoName, triggers, curated }
    })

    window.monaco.languages.registerCompletionItemProvider('cpp', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        let range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        }
        const text = word.word

        // Respect disable flag (exam contest, global toggle)
        if (!isTemplateCompletionEnabled()) return { suggestions: [] }

        // ACWing-style signature detection: line so far looks like
        // "return_type partial_name" (e.g. "void mer", "vector<int> ad", "int h").
        // The return type gives context, so even 1-char name prefixes are safe.
        const beforeCursor = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
        const sigMatch = beforeCursor.match(/^\s*([A-Za-z_][\w:]*(?:<[^>]*>)?[*&]?)\s+([A-Za-z_]\w*)$/)
        let sigPrefix = null
        if (sigMatch) {
          sigPrefix = (sigMatch[1] + ' ' + sigMatch[2]).toLowerCase()
          // Replace the whole typed signature on insert (template includes its own signature)
          const indent = beforeCursor.length - beforeCursor.trimLeft().length
          range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: indent + 1,
            endColumn: position.column
          }
        }

        // Bare-word mode requires at least 3 characters; signature mode does not
        if (!sigPrefix && (!text || text.length < 3)) return { suggestions: [] }

        const lowerText = text.toLowerCase()
        const suggestions = []

        for (const t of templates) {
          let bestScore = 0

          // Curated signature triggers — highest priority, only in signature mode
          if (sigPrefix) {
            for (const ct of t.curated) {
              const c = ct.toLowerCase()
              if (c === sigPrefix) {
                bestScore = Math.max(bestScore, 600)
              } else if (c.startsWith(sigPrefix)) {
                bestScore = Math.max(bestScore, 500)
              }
            }
          }

          // In signature mode with a very short name part ("int h", "void me"),
          // bare-word matching is pure noise — the signature context is authoritative
          const skipWordMatch = sigPrefix && lowerText.length < 3

          for (const trigger of t.triggers) {
            if (skipWordMatch) break
            const tri = trigger.text
            const triLower = tri.toLowerCase()

            // Exact match on function/algorithm name — highest priority
            if (triLower === lowerText) {
              bestScore = Math.max(bestScore, 300 + trigger.priority)
            } else if (triLower.startsWith(lowerText)) {
              // Prefix match (user typed prefix of trigger word)
              bestScore = Math.max(bestScore, 200 + trigger.priority)
            } else if (triLower.includes(lowerText)) {
              // Contains match (user text appears inside trigger)
              bestScore = Math.max(bestScore, 100 + trigger.priority)
            } else if (lowerText.length >= 4 && lowerText.includes(triLower) && triLower.length >= 4) {
              // Trigger contains user text (reverse contains — looser, only for long triggers)
              bestScore = Math.max(bestScore, 50 + trigger.priority)
            }
          }

          if (bestScore === 0) continue

          // Display: function_name — 算法名
          let label = t.fnName || t.algoName
          if (t.algoName && t.algoName !== label) {
            const shortAlgo = t.algoName.length > 12 ? t.algoName.slice(0, 12) + '..' : t.algoName
            label = label + ' — ' + shortAlgo
          }

          // Debug detail shows the full heading + available wake words
          const fnTrigs = t.triggers.filter(x => x.type === 'function').map(x => x.text)
          const allTrigs = fnTrigs.concat(t.curated)
          const detail = t.heading + (allTrigs.length ? ' [' + allTrigs.join(', ') + ']' : '')

          suggestions.push({
            label: label,
            kind: window.monaco.languages.CompletionItemKind.Snippet,
            detail: detail,
            insertText: t.code,
            range: range,
            sortText: String(10000 - bestScore).padStart(5, '0')
          })
        }

        // Sort by score descending, max 5
        suggestions.sort((a, b) => a.sortText.localeCompare(b.sortText))
        return { suggestions: suggestions.slice(0, 5) }
      }
    })
  }

  export default {
    name: 'MonacoEditor',
    props: {
      value: {
        type: String,
        default: ''
      },
      languages: {
        type: Array,
        default: () => {
          return ['C', 'C++', 'Java', 'Python3', 'Golang', 'JavaScript']
        }
      },
      language: {
        type: String,
        default: 'C++'
      },
      theme: {
        type: String,
        default: 'vs'
      },
      enableTemplates: {
        type: Boolean,
        default: true
      }
    },
    data () {
      return {
        editor: null,
        fontSize: 14,
        fontSizes: [12, 14, 16, 18, 20],
        tabSize: 4,
        keymap: 'standard',
        completion: 'advanced',
        settingsVisible: false,
        debugVisible: false,
        debugStatus: '',
        debugInput: '',
        debugOutput: '',
        debugTimeCost: 0,
        mode: {
          'C': 'c',
          'C++': 'cpp',
          'Java': 'java',
          'Python3': 'python',
          'Golang': 'go',
          'JavaScript': 'javascript'
        },
        themes: [
          {label: 'Light', value: 'vs'},
          {label: 'Dark', value: 'vs-dark'},
          {label: 'High Contrast', value: 'hc-black'}
        ]
      }
    },
    computed: {
      filteredLanguages () {
        return (this.languages || []).filter(l => !['Python2', 'Golang', 'JavaScript'].includes(l))
      }
    },
    mounted () {
      this.waitForMonaco()
      utils.getLanguages().then(languages => {
        let mode = {}
        languages.forEach(lang => {
          switch (lang.name) {
            case 'C':
              mode[lang.name] = 'c'
              break
            case 'C++':
              mode[lang.name] = 'cpp'
              break
            case 'Java':
              mode[lang.name] = 'java'
              break
            case 'Python3':
              mode[lang.name] = 'python'
              break
            case 'Golang':
              mode[lang.name] = 'go'
              break
            case 'JavaScript':
              mode[lang.name] = 'javascript'
              break
            default:
              mode[lang.name] = 'plaintext'
          }
        })
        this.mode = mode
        if (this.editor && window.monaco) {
          window.monaco.editor.setModelLanguage(this.editor.getModel(), this.mode[this.language] || 'plaintext')
        }
      })
    },
    methods: {
      waitForMonaco () {
        const check = () => {
          if (window.monaco) {
            this.initEditor()
          } else {
            setTimeout(check, 100)
          }
        }
        setTimeout(check, 100)
      },
      initEditor () {
        const monaco = window.monaco
        if (!monaco) {
          // Monaco not loaded yet, wait for it
          setTimeout(() => this.initEditor(), 100)
          return
        }
        // Register C++ template completion provider
        registerCppTemplateCompletion()

        // Prevent Monaco from hijacking wheel events. Monaco internally
        // attaches wheel handlers with useCapture that eat all wheel input
        // even when the editor is full-height and needs no inner scroll.
        // We intercept at the capture phase (before Monaco's handler fires)
        // and redirect the scroll to the page.
        this.$refs.editorContainer.addEventListener('wheel', (e) => {
          window.scrollBy(0, e.deltaY)
          e.preventDefault()
          e.stopPropagation()
        }, true)

        this.editor = monaco.editor.create(this.$refs.editorContainer, {
          value: this.value,
          language: this.mode[this.language] || 'plaintext',
          theme: this.theme,
          minimap: {
            enabled: false
          },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fontSize: this.fontSize,
          lineNumbers: 'on',
          wordWrap: 'on',
          folding: true,
          glyphMargin: false,
          tabSize: this.tabSize,
          scrollbar: {
            vertical: 'hidden',
            horizontal: 'auto',
            alwaysConsumeMouseWheel: false
          },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false
        })

        // Sync module-level completion mode with component state
        completionMode = this.completion
        // Enable completion based on setting
        this.updateCompletion()

        // Dynamic height: grow with code so Monaco never needs internal scroll.
        // No max-height cap — when the container IS the content, mouse wheel
        // passes through to the page naturally instead of getting captured by
        // Monaco's invisible inner scroll area.
        let lastHeight = 0
        const updateHeight = () => {
          const model = this.editor.getModel()
          if (!model) return
          const lineCount = model.getLineCount()
          const newHeight = Math.max(300, lineCount * 20 + 40)
          if (newHeight === lastHeight) return
          lastHeight = newHeight
          this.$refs.editorContainer.style.height = newHeight + 'px'
          this.editor.layout()
        }
        updateHeight()

        this.editor.onDidChangeModelContent(() => {
          updateHeight()
          this.$emit('update:value', this.editor.getValue())
        })

        // F10 to submit
        this.editor.addCommand(monaco.KeyCode.F10, () => {
          this.$emit('submit')
        })

        // F9 to run tests
        this.editor.addCommand(monaco.KeyCode.F9, () => {
          this.onRunTests()
        })

        // Ctrl+S to save
        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          this.$emit('save')
        })
      },
      onLangChange (newVal) {
        window.monaco.editor.setModelLanguage(this.editor.getModel(), this.mode[newVal] || 'plaintext')
        this.$emit('changeLang', newVal)
      },
      onThemeChange (newTheme) {
        window.monaco.editor.setTheme(newTheme)
        this.$emit('changeTheme', newTheme)
      },
      updateCompletion () {
        if (!this.editor) return
        const completionEnabled = this.completion !== 'off'
        this.editor.updateOptions({
          quickSuggestions: completionEnabled,
          suggestOnTriggerCharacters: completionEnabled,
          wordBasedSuggestions: completionEnabled,
          parameterHints: { enabled: completionEnabled }
        })
      },
      onTabSizeChange (size) {
        this.tabSize = size
        if (this.editor) {
          this.editor.updateOptions({ tabSize: size })
        }
      },
      onCompletionChange (value) {
        this.completion = value
        completionMode = value  // sync with module-level for template provider
        this.updateCompletion()
      },
      onResetClick () {
        this.$emit('resetCode')
      },
      onFontSizeChange (size) {
        this.fontSize = size
        if (this.editor) {
          this.editor.updateOptions({ fontSize: size })
        }
      },
      onRunTests () {
        this.$emit('runTests')
      },
      onDebug () {
        this.debugVisible = true
        this.debugStatus = 'Ready'
        this.$emit('debug', this.debugInput)
      },
      onSubmit () {
        this.$emit('submit')
      },
      onUploadFile () {
        document.getElementById('file-uploader').click()
      },
      onUploadFileDone () {
        let f = document.getElementById('file-uploader').files[0]
        let fileReader = new window.FileReader()
        let self = this
        fileReader.onload = function (e) {
          var text = e.target.result
          self.editor.setValue(text)
          document.getElementById('file-uploader').value = ''
        }
        fileReader.readAsText(f, 'UTF-8')
      }
    },
    watch: {
      'value' (newVal) {
        if (this.editor && newVal !== this.editor.getValue()) {
          this.editor.setValue(newVal)
        }
      },
      'theme' (newVal) {
        window.monaco.editor.setTheme(newVal)
      },
      'enableTemplates' (newVal) {
        templateCompletionLocallyEnabled = newVal
      }
    },
    created () {
      templateCompletionLocallyEnabled = this.enableTemplates
    }
  }
</script>

<style lang="less" scoped>
  .header {
    margin: 5px 5px 15px 5px;
    .adjust {
      width: 150px;
      margin-left: 10px;
    }
    .fl-right {
      float: right;
    }
  }

  .monaco-container {
    width: 100%;
    min-height: 300px;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    overflow: hidden;
  }

  .action-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 10px;
    padding: 8px 12px;
    background: #f8f8f9;
    border: 1px solid #e8eaec;
    border-radius: 4px;

    .action-left {
      display: flex;
      align-items: center;
    }

    .action-right {
      display: flex;
      align-items: center;
    }

    .font-select {
      width: 70px;
    }
  }

  .custom-test-panel {
    .test-section {
      margin-bottom: 16px;

      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;

        .section-title {
          font-weight: 600;
          font-size: 14px;
        }
      }
    }

    .test-actions {
      margin-bottom: 16px;
    }

    .test-result {
      .result-output {
        background: #f8f8f9;
        padding: 12px;
        border-radius: 4px;
        border: 1px solid #e8eaec;
        font-size: 13px;
        overflow-x: auto;
      }
    }
  }

  .debug-panel {
    margin-top: 10px;
    border: 1px solid #e8eaec;
    border-radius: 4px;
    overflow: hidden;

    .debug-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: #f8f8f9;
      border-bottom: 1px solid #e8eaec;
      font-weight: 600;
      font-size: 14px;
    }

    .debug-body {
      padding: 12px;
    }

    .debug-section {
      margin-bottom: 12px;

      &:last-child {
        margin-bottom: 0;
      }
    }

    .debug-label {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 4px;
    }

    .debug-output {
      background: #1d1e1f;
      color: #e8eaec;
      padding: 12px;
      border-radius: 4px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
      font-size: 13px;
      overflow-x: auto;
      min-height: 60px;
      max-height: 300px;
      overflow-y: auto;

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-wrap: break-word;
      }
    }

    .debug-meta {
      margin-top: 8px;
      font-size: 12px;
      color: #808695;
    }
  }
</style>
