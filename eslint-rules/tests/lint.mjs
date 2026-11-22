import { ESLint } from 'eslint'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const eslint = new ESLint({ cwd: root })

export async function ruleIds(file, code) {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) })
  if (!result) throw new Error(`${file} is not linted at all`)
  const fatal = result.messages.find((message) => message.fatal)
  if (fatal) throw new Error(`${file} does not parse: ${fatal.message}`)
  return result.messages.map((message) => message.ruleId)
}

const fixer = new ESLint({ cwd: root, fix: true })

export async function fixed(file, code) {
  const [result] = await fixer.lintText(code, { filePath: path.join(root, file) })
  return result.output ?? code
}
