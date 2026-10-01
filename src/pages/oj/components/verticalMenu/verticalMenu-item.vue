<template>
  <li @click.stop="handleClick" :class="{disabled: disabled}">
    <slot></slot>
  </li>
</template>

<script>
  import Emitter from '../mixins/emitter'

  export default {
    name: 'VerticalMenu-item',
    mixins: [Emitter],
    props: {
      route: {
        type: [String, Object]
      },
      disabled: {
        type: Boolean,
        default: false
      }
    },
    methods: {
      handleClick () {
        if (this.route) {
          this.dispatch('VerticalMenu', 'on-click', this.route)
        }
      }
    }
  }
</script>

<style scoped lang="less">
  .disabled {
    /*background-color: var(--c-text-3);*/
    opacity: 1;
    /*cursor: not-allowed;*/
    pointer-events: none;
    color: var(--c-text-3);
    &:hover {
      border-left: none;
      color: var(--c-text-3);
      background: var(--c-bg-card);
    }
  }

  li {
    border-bottom: 1px dashed var(--c-border);
    color: var(--c-text-2);
    display: block;
    text-align: left;
    padding: 15px 20px;
    &:hover {
      background: var(--c-bg-soft);
      border-left: 2px solid var(--c-brand-hover);
      color: var(--c-brand);
    }
    & > .ivu-icon {
      font-size: 16px;
      margin-right: 8px;
    }
    &:last-child {
      border-bottom: none;
    }
  }
</style>
