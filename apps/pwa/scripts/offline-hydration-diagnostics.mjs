/** Optional Chromium diagnostic. Pauses only the actual React hydration mismatch function. */
export async function diagnoseHydration(context, report) {
  context.on('page', async page => {
    const session = await context.newCDPSession(page)
    const matchers = new Map()
    await session.send('Debugger.enable')
    session.on('Debugger.paused', async paused => {
      const frame = paused.callFrames[0]
      const matcher = matchers.get(frame.functionName)
      if (!matcher) { await session.send('Debugger.resume').catch(() => {}); return }
      const { fiber, parent, next } = matcher
      const expression = `JSON.stringify((()=>{const chain=[];for(let f=${fiber};f&&chain.length<60;f=f.return)chain.push({type:typeof f.type==='string'?f.type:f.type?.name??f.type?.displayName??'wrapper',tag:f.tag,node:f.stateNode?.outerHTML?.slice(0,160),props:Object.fromEntries(Object.entries(f.pendingProps??{}).filter(([,v])=>['string','number','boolean'].includes(typeof v)))});const node=${next},parents=[];for(let p=node?.parentElement;p&&parents.length<8;p=p.parentElement)parents.push({tag:p.tagName,id:p.id,class:p.className});const siblings=[];for(let c=${fiber}.return?.child;c&&siblings.length<15;c=c.sibling)siblings.push({type:typeof c.type==='string'?c.type:c.type?.name??'wrapper',id:c.pendingProps?.id,node:c.stateNode?.outerHTML?.slice(0,160)});return{claims:window.__offlineHydrationClaims,chain,siblings,sameParent:${parent}===${fiber},stateNode:${fiber}.stateNode?.outerHTML?.slice(0,500),parentType:typeof ${parent}?.type==='string'?${parent}.type:${parent}?.type?.name,parentProps:${parent}?.pendingProps?.className,parentDOM:${parent}?.stateNode?.outerHTML?.slice(0,500),next:node?.outerHTML??node?.textContent,nextType:node?.nodeType,parents,previous:node?.previousSibling?.outerHTML,body:document.getElementById('app-shell')?.innerHTML?.slice(0,1500)}})())`
      const result = await session.send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression, returnByValue: true }).catch(error => ({ error: error.message }))
      report({ url: page.url(), frames: paused.callFrames.slice(0,5).map(frame=>({name:frame.functionName,location:frame.location})), reactMismatch: result.result?.value ? JSON.parse(result.result.value) : result })
      await session.send('Debugger.resume').catch(() => {})
    })
    session.on('Debugger.scriptParsed', async event => {
      if (!event.url.includes('/_next/static/chunks/')) return
      const { scriptSource: source } = await session.send('Debugger.getScriptSource', { scriptId: event.scriptId }).catch(() => ({ scriptSource: '' }))
      const match = /function (\w+)\((\w+)\)\{var \w+=Error\(\w+\(418,/.exec(source)
      if (!match) return
      const prefix = source.slice(Math.max(0, match.index - 400), match.index)
      const states = [...prefix.matchAll(/var (\w+)=null,(\w+)=null,/g)].at(-1)
      if (!states) return
      const claims = [...source.matchAll(/(\w+)\.stateNode=(\w+),(\w+)=\1,(\w+)=\w+\(\2\.firstChild\)/g)]
      for (const claim of process.env.OFFLINE_SMOKE_CLAIM_TRACE === '1' ? claims : []) {
        const [, expected, actual] = claim
        const condition = `(${expected}.type==='div'&&(${expected}.pendingProps?.id==='app-shell'||${expected}.pendingProps?.className==='min-h-screen')&&(window.__offlineHydrationClaims??=[]).push({expected:{id:${expected}.pendingProps?.id,class:${expected}.pendingProps?.className},actual:${actual}.outerHTML?.slice(0,200),time:performance.now()})),false`
        await session.send('Debugger.setBreakpoint', { location: { scriptId: event.scriptId, lineNumber: 0, columnNumber: claim.index }, condition }).catch(() => {})
      }
      matchers.set(match[1], { fiber: match[2], parent: states[1], next: states[2] })
      await session.send('Debugger.setBreakpoint', { location: { scriptId: event.scriptId, lineNumber: 0, columnNumber: match.index + match[0].indexOf('var ') } }).catch(() => {})
    })
  })
}
