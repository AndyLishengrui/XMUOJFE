<template>
  <div style="margin: 0px 0px 15px 0px">
    <Row type="flex" justify="space-between" class="header">
      <Col :span=12>
      <div>
        <span>{{$t('m.Language')}}:</span>
        <Select :value="language" @on-change="onLangChange" class="adjust">
          <Option v-for="item in languages" :key="item" :value="item">{{item}}
          </Option>
        </Select>

        <Tooltip :content="this.$i18n.t('m.Reset_to_default_code_definition')" placement="top" style="margin-left: 10px">
          <Button icon="refresh" @click="onResetClick"></Button>
        </Tooltip>

        <Tooltip :content="this.$i18n.t('m.Upload_file')" placement="top" style="margin-left: 10px">
          <Button icon="upload" @click="onUploadFile"></Button>
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
    <div ref="editorContainer" style="width: 100%; min-height: 300px; max-height: 1000px; border: 1px solid #e8e8e8; border-radius: 4px;"></div>
  </div>
</template>
<script>
  import utils from '@/utils/utils'
  import * as monaco from 'monaco-editor'

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
      }
    },
    data () {
      return {
        editor: null,
        mode: {
          'C': 'c',
          'C++': 'cpp',
          'Java': 'java',
          'Python3': 'python',
          'Golang': 'go',
          'JavaScript': 'javascript'
        },
        themes: [
          {label: this.$i18n.t('m.Light'), value: 'vs'},
          {label: this.$i18n.t('m.Dark'), value: 'vs-dark'},
          {label: this.$i18n.t('m.High_Contrast'), value: 'hc-black'}
        ]
      }
    },
    mounted () {
      this.initEditor()
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
        this.editor.setModelLanguage(this.editor.getModel(), this.mode[this.language] || 'plaintext')
      })
    },
    beforeDestroy () {
      if (this.editor) {
        this.editor.dispose()
      }
    },
    methods: {
      initEditor () {
        this.editor = monaco.editor.create(this.$refs.editorContainer, {
          value: this.value,
          language: this.mode[this.language] || 'plaintext',
          theme: this.theme,
          minimap: {
            enabled: true
          },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fontSize: 14,
          lineNumbers: 'on',
          wordWrap: 'on',
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto'
          }
        })

        this.editor.onDidChangeModelContent(() => {
          this.$emit('update:value', this.editor.getValue())
        })
      },
      onLangChange (newVal) {
        this.editor.setModelLanguage(this.editor.getModel(), this.mode[newVal] || 'plaintext')
        this.$emit('changeLang', newVal)
      },
      onThemeChange (newTheme) {
        monaco.editor.setTheme(newTheme)
        this.$emit('changeTheme', newTheme)
      },
      onResetClick () {
        this.$emit('resetCode')
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
        monaco.editor.setTheme(newVal)
      }
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
</style>
