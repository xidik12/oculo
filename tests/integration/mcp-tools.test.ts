import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const SRC_ROOT = path.join(__dirname, '../../src')
const PROJECT_ROOT = path.join(__dirname, '../..')

describe('MCP Tool Schema Consistency', () => {
  const serverPath = path.join(SRC_ROOT, 'main/mcp/server.ts')
  const agentPath = path.join(SRC_ROOT, 'main/ai/agent.ts')

  it('server.ts should exist', () => {
    expect(fs.existsSync(serverPath)).toBe(true)
  })

  it('agent.ts should exist', () => {
    expect(fs.existsSync(agentPath)).toBe(true)
  })

  it('server.ts should define at least 5 tools (page, act, fill, read, run)', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    // Count tool name definitions
    const toolNames = serverCode.match(/name:\s*'(\w+)'/g)
    expect(toolNames).toBeTruthy()
    expect(toolNames!.length).toBeGreaterThanOrEqual(5)
  })

  it('server.ts should define the 5 core tools', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    const coreTools = ['page', 'act', 'fill', 'read', 'run']
    for (const tool of coreTools) {
      expect(serverCode).toContain(`name: '${tool}'`)
    }
  })

  it('agent.ts should define tool descriptions for the AI', () => {
    const agentCode = fs.readFileSync(agentPath, 'utf-8')
    const coreTools = ['page', 'act', 'fill', 'read', 'run']
    for (const tool of coreTools) {
      expect(agentCode).toContain(`name: '${tool}'`)
    }
  })

  it('every tool should have a description', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    // Find tool blocks — each tool has { name: 'xxx', description: 'xxx', ... }
    const toolNameMatches = [...serverCode.matchAll(/name:\s*'(\w+)'/g)]
    for (const match of toolNameMatches) {
      // After each name there should be a description within the same block
      const namePos = match.index!
      const nextChunk = serverCode.substring(namePos, namePos + 500)
      expect(nextChunk).toContain('description')
    }
  })

  it('every tool should have an inputSchema', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    const toolNameMatches = [...serverCode.matchAll(/name:\s*'(\w+)'/g)]
    for (const match of toolNameMatches) {
      const namePos = match.index!
      const nextChunk = serverCode.substring(namePos, namePos + 2000)
      expect(nextChunk).toContain('inputSchema')
    }
  })

  it('act tool should define action enum in server.ts', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    // Find the act tool section and check for action enum
    const actIdx = serverCode.indexOf("name: 'act'")
    expect(actIdx).toBeGreaterThan(-1)
    const actBlock = serverCode.substring(actIdx, actIdx + 2000)
    expect(actBlock).toContain('enum:')
    expect(actBlock).toContain('click')
    expect(actBlock).toContain('navigate')
    expect(actBlock).toContain('scroll')
  })

  it('act tool actions in server.ts should include essential actions', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    const actIdx = serverCode.indexOf("name: 'act'")
    const actBlock = serverCode.substring(actIdx, actIdx + 2000)

    const essentialActions = ['click', 'navigate', 'back', 'forward', 'scroll', 'press', 'hover', 'login', 'reload', 'type']
    for (const action of essentialActions) {
      expect(actBlock).toContain(`'${action}'`)
    }
  })

  it('fill tool should require fields parameter', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    const fillIdx = serverCode.indexOf("name: 'fill'")
    expect(fillIdx).toBeGreaterThan(-1)
    const fillBlock = serverCode.substring(fillIdx, fillIdx + 1000)
    expect(fillBlock).toContain("required: ['fields']")
  })

  it('read tool should require what parameter', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    const readIdx = serverCode.indexOf("name: 'read'")
    expect(readIdx).toBeGreaterThan(-1)
    const readBlock = serverCode.substring(readIdx, readIdx + 1000)
    expect(readBlock).toContain("required: ['what']")
  })

  it('media tool should require type and prompt parameters', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    const mediaIdx = serverCode.indexOf("name: 'media'")
    expect(mediaIdx).toBeGreaterThan(-1)
    const mediaBlock = serverCode.substring(mediaIdx, mediaIdx + 2000)
    expect(mediaBlock).toContain("required: ['type', 'prompt']")
  })
})

describe('MCP Server HTTP endpoints', () => {
  const serverPath = path.join(SRC_ROOT, 'main/mcp/server.ts')

  it('should handle /health endpoint', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    expect(serverCode).toContain("'/health'")
    expect(serverCode).toContain("status: 'ok'")
  })

  it('should handle /mcp endpoint', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    expect(serverCode).toContain("'/mcp'")
  })

  it('should require auth token on /mcp endpoint', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    expect(serverCode).toContain('authorization')
    expect(serverCode).toContain('Unauthorized')
  })

  it('should handle tools/list method', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    expect(serverCode).toContain("'tools/list'")
  })

  it('should handle tools/call method', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    expect(serverCode).toContain("'tools/call'")
  })

  it('should write port file on startup', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    expect(serverCode).toContain('.oculo-port')
  })

  it('should delete port file on stop', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    expect(serverCode).toContain('unlinkSync')
  })
})

describe('MCP Tool Improvements', () => {
  const serverPath = path.join(SRC_ROOT, 'main/mcp/server.ts')
  const bridgePath = path.join(PROJECT_ROOT, 'bin/oculo-mcp.mjs')
  const pipelinePath = path.join(SRC_ROOT, 'main/engine/pipeline.ts')
  const describerPath = path.join(SRC_ROOT, 'main/engine/describer.ts')

  it('run tool schema should document all 6 step types', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    const runIdx = serverCode.indexOf("name: 'run'")
    expect(runIdx).toBeGreaterThan(-1)
    // Look at the run tool block (generous window for the expanded schema)
    const runBlock = serverCode.substring(runIdx, runIdx + 5000)
    const stepTypes = ['page', 'act', 'fill', 'read', 'wait', 'if']
    for (const step of stepTypes) {
      expect(runBlock).toContain(`${step}:`)
    }
  })

  it('bridge STATIC_TOOLS should define the same tools as server.ts', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf-8')
    const bridgeCode = fs.readFileSync(bridgePath, 'utf-8')

    // Extract tool names from server.ts tools array (between 'tools = [' and matching ']')
    const serverToolsSection = serverCode.substring(
      serverCode.indexOf('tools = ['),
      serverCode.indexOf(']', serverCode.indexOf("name: 'media'") + 500) + 1
    )
    const serverTools = [...serverToolsSection.matchAll(/name:\s*'(\w+)'/g)].map(m => m[1])

    // Extract tool names from bridge STATIC_TOOLS array
    const bridgeToolsSection = bridgeCode.substring(
      bridgeCode.indexOf('STATIC_TOOLS = ['),
      bridgeCode.indexOf(']', bridgeCode.indexOf("name: 'media'", bridgeCode.indexOf('STATIC_TOOLS')) + 500) + 1
    )
    const bridgeTools = [...bridgeToolsSection.matchAll(/name:\s*'(\w+)'/g)].map(m => m[1])

    expect(serverTools.sort()).toEqual(bridgeTools.sort())
  })

  it('pipeline wait should throw on timeout instead of returning a string', () => {
    const pipelineCode = fs.readFileSync(pipelinePath, 'utf-8')
    // Should throw, not return
    expect(pipelineCode).toContain('throw new Error(`Wait timeout')
    expect(pipelineCode).not.toContain('return `Wait timeout')
  })

  it('describer should not skip unlabeled inputs with if (label) guard', () => {
    const describerCode = fs.readFileSync(describerPath, 'utf-8')
    // The old pattern was: if (label) { fields.push(...) }
    // New code uses: const displayLabel = label || ...
    expect(describerCode).not.toMatch(/if\s*\(label\)\s*\{[\s\S]*?fields\.push/)
    expect(describerCode).toContain('displayLabel')
  })
})
