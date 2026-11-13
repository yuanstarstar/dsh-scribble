import { registerTools } from './lib/tools.js'

export const inject = ['tools']

export function apply(ctx) {
  registerTools(ctx)
}
