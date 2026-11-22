const ALLOWED = /^\/\s*<reference\s/
const TOKEN_END = /[^\s([{]/
const TOKEN_START = /[^\s)\]},;]/

export default {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    schema: [],
    messages: {
      banned:
        'Comments are banned in src/: they go stale and nothing enforces them. Delete it and put the intent in code instead: a precise name, a narrower type, a lint rule in eslint-rules/, or a journey in .agents/skills/verify-mailsy/features/.',
      disable:
        'Disabling a lint rule inline is banned in src/. Fix the root cause the rule is pointing at; if the rule itself is wrong, change it in eslint.config.mjs where the change gets reviewed.'
    }
  },
  create(context) {
    const source = context.sourceCode
    const text = source.text

    function removalRange(comment) {
      let [start, end] = comment.range
      let inJsx = false
      const before = source.getTokenBefore(comment, { includeComments: true })
      const after = source.getTokenAfter(comment, { includeComments: true })
      if (
        before?.type === 'Punctuator' &&
        before.value === '{' &&
        after?.type === 'Punctuator' &&
        after.value === '}' &&
        source.getNodeByRangeIndex(before.range[0])?.type === 'JSXExpressionContainer'
      ) {
        start = before.range[0]
        end = after.range[1]
        inJsx = true
      }
      let lineStart = start
      while (lineStart > 0 && (text[lineStart - 1] === ' ' || text[lineStart - 1] === '\t')) {
        lineStart--
      }
      let lineEnd = end
      while (lineEnd < text.length && (text[lineEnd] === ' ' || text[lineEnd] === '\t')) lineEnd++
      const ownsLine =
        (lineStart === 0 || text[lineStart - 1] === '\n') &&
        (lineEnd === text.length || text[lineEnd] === '\n' || text[lineEnd] === '\r')
      if (!ownsLine) return { range: [inJsx ? start : lineStart, end], inJsx }
      if (text[lineEnd] === '\r') lineEnd++
      if (text[lineEnd] === '\n') lineEnd++
      return { range: [lineStart, lineEnd], inJsx }
    }

    return {
      Program() {
        for (const comment of source.getAllComments()) {
          if (comment.type === 'Shebang') continue
          if (comment.type === 'Line' && ALLOWED.test(comment.value)) continue
          const isDisable = /^\s*eslint-(disable|enable)/.test(comment.value)
          context.report({
            loc: comment.loc,
            messageId: isDisable ? 'disable' : 'banned',
            fix: (fixer) => {
              const { range, inJsx } = removalRange(comment)
              const [start, end] = range
              if (inJsx) return fixer.removeRange(range)
              const joinsTokens =
                TOKEN_END.test(text[start - 1] ?? '') && TOKEN_START.test(text[end] ?? '')
              const endedTheLine =
                comment.value.includes('\n') && end < text.length && text[end - 1] !== '\n'
              const separator = endedTheLine ? '\n' : joinsTokens ? ' ' : ''
              return fixer.replaceTextRange([start, end], separator)
            }
          })
        }
      }
    }
  }
}
