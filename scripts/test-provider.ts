import { generateText } from '../src/providers/index.ts'

const result = await generateText(
  'You are a terse assistant.',
  "Say 'provider works' and nothing else.",
)

console.log('Result:', result)
if (!result.toLowerCase().includes('works')) process.exit(1)
console.log('✅ provider test passed')
