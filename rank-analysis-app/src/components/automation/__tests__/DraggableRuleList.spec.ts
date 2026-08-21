import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { NButton, NCheckbox, NAvatar } from 'naive-ui'
import DraggableRuleList from '../DraggableRuleList.vue'
import type { PickRule } from '@renderer/types/rules'
import type { championOption } from '@renderer/types/domain/champion'

describe('DraggableRuleList.vue', () => {
  const options: championOption[] = [
    { label: '暗裔剑魔', value: 266, realName: '亚托克斯', nickname: '剑魔' },
    { label: '阿狸', value: 103, realName: '阿狸', nickname: '九尾狐' }
  ]

  const pickRules: PickRule[] = [
    {
      id: 'rule-1',
      name: '上路先手',
      enabled: true,
      conditions: [{ type: 'Position', value: 'top' }],
      action: { champion_id: 266, lock: true }
    }
  ]

  it('renders rule name and summaries correctly', () => {
    const wrapper = mount(DraggableRuleList, {
      props: {
        rules: pickRules,
        assetPrefix: 'http://127.0.0.1:3000',
        championOptions: options
      },
      global: {
        components: {
          'n-button': NButton,
          'n-checkbox': NCheckbox,
          'n-avatar': NAvatar
        }
      }
    })

    expect(wrapper.text()).toContain('上路先手')
    expect(wrapper.text()).toContain('上路 → 选 暗裔剑魔 [锁]')
  })

  it('emits toggle, edit, and delete events', async () => {
    const wrapper = mount(DraggableRuleList, {
      props: {
        rules: pickRules,
        assetPrefix: 'http://127.0.0.1:3000',
        championOptions: options
      },
      global: {
        components: {
          'n-button': NButton,
          'n-checkbox': NCheckbox,
          'n-avatar': NAvatar
        }
      }
    })

    const buttons = wrapper.findAllComponents(NButton)
    const editBtn = buttons.find(b => b.text() === '编辑')
    const deleteBtn = buttons.find(b => b.text() === '删除')

    expect(editBtn).toBeDefined()
    expect(deleteBtn).toBeDefined()

    await editBtn!.trigger('click')
    expect(wrapper.emitted('edit')).toHaveLength(1)
    expect(wrapper.emitted('edit')![0]).toEqual([pickRules[0]])

    await deleteBtn!.trigger('click')
    expect(wrapper.emitted('delete')).toHaveLength(1)
    expect(wrapper.emitted('delete')![0]).toEqual(['rule-1'])

    const checkbox = wrapper.findComponent(NCheckbox)
    expect(checkbox.exists()).toBe(true)
    checkbox.vm.$emit('update:checked', false)
    expect(wrapper.emitted('toggle')).toHaveLength(1)
    expect(wrapper.emitted('toggle')![0]).toEqual(['rule-1', false])
  })
})
