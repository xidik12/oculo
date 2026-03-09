/**
 * Pure JS string-builder functions for webview.executeJavaScript().
 * No React dependencies — every function returns a JS code string.
 */
import type { ElementFingerprint } from '@shared/types'

// ---------------------------------------------------------------------------
// Shared fuzzyMatch JS code — injectable into any in-page script.
// Returns JS function declaration string for fuzzyMatch(a,b) -> boolean.
// ---------------------------------------------------------------------------
export function fuzzyMatchCode(): string {
  return 'function fuzzyMatch(a,b){' +
    'a=a.toLowerCase();b=b.toLowerCase();' +
    'if(a===b||a.includes(b)||b.includes(a))return true;' +
    'var ta=a.split(/[\\s\\-_\\/]+/).filter(function(t){return t.length>2;});' +
    'var tb=b.split(/[\\s\\-_\\/]+/).filter(function(t){return t.length>2;});' +
    'if(!ta.length||!tb.length)return false;' +
    'var matches=0;for(var i=0;i<ta.length;i++){for(var j=0;j<tb.length;j++){if(ta[i]===tb[j])matches++;}}' +
    'return matches>=Math.min(ta.length,tb.length)*0.5;}'
}

// ---------------------------------------------------------------------------
// buildClickCode — click element by text/selector/ref, searches main doc +
// iframes + shadow DOM. Returns candidate info when not found or ambiguous.
// ---------------------------------------------------------------------------
export function buildClickCode(text: string, selector: string, nth: number, modifiers?: string[]): string {
  const mods = modifiers || []
  const modFlags = '{bubbles:true,clientX:cx__N__,clientY:cy__N__' +
    (mods.includes('ctrl') || mods.includes('control') ? ',ctrlKey:true' : '') +
    (mods.includes('shift') ? ',shiftKey:true' : '') +
    (mods.includes('alt') ? ',altKey:true' : '') +
    (mods.includes('meta') || mods.includes('cmd') ? ',metaKey:true' : '') +
    '}'
  // Generate modifier flags for each click location variant (0, 1, 2)
  const mf0 = modFlags.replace(/__N__/g, '0')
  const mf1 = modFlags.replace(/__N__/g, '1')
  const mf2 = modFlags.replace(/__N__/g, '2')
  return '(function(){' +
    'var text=' + JSON.stringify(text) + ';' +
    'var sel=' + JSON.stringify(selector) + ';' +
    'var nth=' + nth + ';' +
    // Shared fuzzy match function
    fuzzyMatchCode() +
    // Click by ref number: text="#3" -> click window.__oculoRefs[2]
    'if(text.match(/^#\\d+$/)&&window.__oculoRefs){' +
    'var idx=parseInt(text.substring(1))-1;' +
    'var ref=window.__oculoRefs[idx];' +
    'if(ref){ref.scrollIntoView({block:"center"});' +
    'var r0=ref.getBoundingClientRect();var cx0=r0.left+r0.width/2+Math.random()*4-2,cy0=r0.top+r0.height/2+Math.random()*4-2;' +
    'ref.dispatchEvent(new MouseEvent("mouseover",' + mf0 + '));' +
    'ref.dispatchEvent(new MouseEvent("mousedown",' + mf0 + '));' +
    'ref.dispatchEvent(new MouseEvent("mouseup",' + mf0 + '));' +
    'ref.dispatchEvent(new MouseEvent("click",' + mf0 + '));' +
    'return "Clicked #"+(idx+1)+" \\""+((ref.textContent||"").trim().substring(0,40))+"\\""}' +
    'return "Ref "+text+" not found ("+window.__oculoRefs.length+" refs available)";}' +
    // Visibility helper
    'function vis(el){if(!el)return false;var r=el.getBoundingClientRect();' +
    'if(r.width<2||r.height<2)return false;' +
    'var s=getComputedStyle(el);' +
    'return s.display!=="none"&&s.visibility!=="hidden"&&s.opacity!=="0";}' +
    'var els=[];' +
    // Fix 7: Dedup by ancestry + interactive element preference
    'function dedup(arr){return arr.filter(function(el){' +
    'return !arr.some(function(other){return other!==el&&el.contains(other);});' +  // remove parents when child also matches
    '});}' +
    'function interScore(el){var t=el.tagName;' +
    'if(t==="BUTTON")return 12;if(t==="A")return 11;if(t==="INPUT")return 10;' +
    'if(el.getAttribute("role")==="button")return 9;if(t==="LABEL")return 7;' +
    'if(t==="SPAN"||t==="LI")return 3;return 1;}' +
    // Search main document -- only visible elements
    'if(sel)els=Array.from(document.querySelectorAll(sel)).filter(vis);' +
    'else if(text){' +
    'var all=Array.from(document.querySelectorAll("a,button,[role=button],input[type=submit],[onclick],label,span[onclick],div[role=button],li[onclick]")).filter(vis);' +
    'els=all.filter(function(el){' +
    'var t=(el.textContent||"").trim().toLowerCase();' +
    'var aria=(el.getAttribute("aria-label")||"").toLowerCase();' +
    'return t===text.toLowerCase()||aria===text.toLowerCase();' +  // exact match first
    '});' +
    'if(!els.length){' + // fallback to partial match
    'els=all.filter(function(el){' +
    'var t=(el.textContent||"").trim().toLowerCase();' +
    'var aria=(el.getAttribute("aria-label")||"").toLowerCase();' +
    'return t.includes(text.toLowerCase())||aria.includes(text.toLowerCase());' +
    '});}' +
    // Fuzzy tier: token overlap matching (e.g. "Sign Up" matches "Sign Up Now")
    'if(!els.length){' +
    'els=all.filter(function(el){' +
    'var t=(el.textContent||"").trim();' +
    'var aria=el.getAttribute("aria-label")||"";' +
    'return fuzzyMatch(t,text)||fuzzyMatch(aria,text);' +
    '});}' +
    // Fix 7: Dedup ancestors, then sort by interactivity score
    'els=dedup(els);' +
    'els.sort(function(a,b){return interScore(b)-interScore(a);});' +
    '}' +
    // Search inside iframes if not found in main document
    'if(!els.length){' +
    'var iframes=document.querySelectorAll("iframe");' +
    'for(var i=0;i<iframes.length;i++){' +
    'try{var doc=iframes[i].contentDocument||iframes[i].contentWindow.document;' +
    'if(!doc)continue;' +
    'if(sel){els=Array.from(doc.querySelectorAll(sel));if(els.length)break;}' +
    'else if(text){' +
    'var all2=Array.from(doc.querySelectorAll("a,button,[role=button],input[type=submit],[onclick],label,span,div[role=button]"));' +
    'els=all2.filter(function(el){var t=(el.textContent||"").trim().toLowerCase();return t===text.toLowerCase();});' +
    'if(!els.length)els=all2.filter(function(el){var t=(el.textContent||"").trim().toLowerCase();return t.includes(text.toLowerCase());});' +
    'if(els.length)break;}' +
    '}catch(e){}}' +
    '}' +
    // Search shadow DOMs
    'if(!els.length){' +
    'function searchShadow(root){' +
    'var all=root.querySelectorAll("*");' +
    'for(var i=0;i<all.length;i++){' +
    'if(!all[i].shadowRoot)continue;' +
    'var sr=all[i].shadowRoot;' +
    'if(sel){var found=Array.from(sr.querySelectorAll(sel));if(found.length){els=found;return;}}' +
    'else if(text){var sAll=Array.from(sr.querySelectorAll("a,button,[role=button],input[type=submit]"));' +
    'var match=sAll.filter(function(el){var t=(el.textContent||"").trim().toLowerCase();return t.includes(text.toLowerCase());});' +
    'if(match.length){els=match;return;}}' +
    'searchShadow(sr);}}' +
    'try{searchShadow(document);}catch(e){}}' +
    // Not found among visible -- try ALL elements (including scrolled-out-of-view in modals)
    'if(!els.length){' +
    'if(sel)els=Array.from(document.querySelectorAll(sel));' +
    'else if(text){' +
    'var all3=Array.from(document.querySelectorAll("a,button,[role=button],input[type=submit],[onclick],label,span[onclick],div[role=button],li[onclick]"));' +
    'els=all3.filter(function(el){var t=(el.textContent||"").trim().toLowerCase();var aria=(el.getAttribute("aria-label")||"").toLowerCase();return t===text.toLowerCase()||aria===text.toLowerCase();});' +
    'if(!els.length)els=all3.filter(function(el){var t=(el.textContent||"").trim().toLowerCase();var aria=(el.getAttribute("aria-label")||"").toLowerCase();return t.includes(text.toLowerCase())||aria.includes(text.toLowerCase());});' +
    '}' +
    // Found in DOM but was scrolled out -- scroll into view and click
    'if(els.length){' +
    'var el2=els[nth]||els[0];el2.scrollIntoView({block:"center",behavior:"smooth"});' +
    'setTimeout(function(){' +
    'var r2=el2.getBoundingClientRect();var cx2=r2.left+r2.width/2+Math.random()*4-2,cy2=r2.top+r2.height/2+Math.random()*4-2;' +
    'el2.dispatchEvent(new MouseEvent("mouseover",' + mf2 + '));' +
    'el2.dispatchEvent(new MouseEvent("mousedown",' + mf2 + '));' +
    'el2.dispatchEvent(new MouseEvent("mouseup",' + mf2 + '));' +
    'el2.dispatchEvent(new MouseEvent("click",' + mf2 + '));' +
    '},300);' +
    'return "Scrolled to and clicked \\""+((el2.textContent||"").trim().substring(0,50))+"\\" (was out of view)";}' +
    '}' +
    // Truly not found -- return candidates
    'if(!els.length){' +
    'var candidates=[];' +
    'if(text){' +
    'var allClickable=Array.from(document.querySelectorAll("a,button,[role=button],input[type=submit]"));' +
    'allClickable.forEach(function(el){' +
    'var t=(el.textContent||"").trim().substring(0,40);' +
    'if(t)candidates.push(t);' +
    '});' +
    '}' +
    'return "Element not found: "+(text||sel)+(candidates.length?"\\nAll clickable elements on page: "+candidates.slice(0,10).join(" | "):"");' +
    '}' +
    // Multiple matches -- click best, report others
    'var el=els[nth]||els[0];' +
    'el.scrollIntoView({block:"center"});' +
    'var r1=el.getBoundingClientRect();var cx1=r1.left+r1.width/2+Math.random()*4-2,cy1=r1.top+r1.height/2+Math.random()*4-2;' +
    'el.dispatchEvent(new MouseEvent("mouseover",' + mf1 + '));' +
    'el.dispatchEvent(new MouseEvent("mousedown",' + mf1 + '));' +
    'el.dispatchEvent(new MouseEvent("mouseup",' + mf1 + '));' +
    'el.dispatchEvent(new MouseEvent("click",' + mf1 + '));' +
    'var clicked=(el.textContent||"").trim().substring(0,50);' +
    'var r="Clicked \\""+clicked+"\\"";' +
    'if(els.length>1)r+=" ("+els.length+" matches — use nth:N to pick another)";' +
    'return r;' +
    '})()'
}

// ---------------------------------------------------------------------------
// buildFillCode — fill form fields by label matching (main doc + iframes +
// shadow DOM). Supports CSS selectors, ID, label text, attributes, nearby
// text, and contenteditable elements.
// ---------------------------------------------------------------------------
export function buildFillCode(entries: [string, unknown][], submit: any): string {
  let code = '(function(){' +
    'var entries=' + JSON.stringify(entries) + ';' +
    'var filled=[];var mismatched=[];' +
    // Count fields before filling (for dynamic re-scan)
    'var fieldsBefore=document.querySelectorAll("input:not([type=hidden]),textarea,select").length;' +
    // Build list of documents to search (main + iframe docs)
    'var docs=[document];' +
    'var iframes=document.querySelectorAll("iframe");' +
    'for(var fi=0;fi<iframes.length;fi++){' +
    'try{var d=iframes[fi].contentDocument||iframes[fi].contentWindow.document;if(d)docs.push(d);}catch(e){}}' +
    // Also collect shadow DOM documents
    'function collectShadowDocs(root){' +
    'var all=root.querySelectorAll("*");' +
    'for(var si=0;si<all.length;si++){' +
    'if(all[si].shadowRoot)docs.push(all[si].shadowRoot);collectShadowDocs(all[si].shadowRoot);}' +
    '}' +
    'try{collectShadowDocs(document);}catch(e){}' +
    // Helper: get visible text near a field (preceding label text, parent text)
    'function nearbyText(el){' +
    'var texts=[];' +
    'if(el.id){var lb=document.querySelector("label[for=\\""+el.id+"\\"]");if(lb)texts.push(lb.textContent.trim());}' +
    'var wl=el.closest("label");if(wl)texts.push(wl.textContent.trim());' +
    'var prev=el.previousElementSibling;' +
    'if(prev){var pt=prev.textContent.trim();if(pt.length>1&&pt.length<200)texts.push(pt);}' +
    'var par=el.parentElement;' +
    'if(par){var kids=Array.from(par.children);var idx=kids.indexOf(el);' +
    'for(var k=Math.max(0,idx-2);k<idx;k++){var kt=kids[k].textContent.trim();if(kt.length>1&&kt.length<200)texts.push(kt);}}' +
    'var descId=el.getAttribute("aria-describedby");' +
    'if(descId){var dEl=document.getElementById(descId);if(dEl)texts.push(dEl.textContent.trim());}' +
    'return texts;}' +
    // Helper: fuzzy match (shared)
    fuzzyMatchCode() +
    // Main loop
    'for(var i=0;i<entries.length;i++){' +
    'var label=entries[i][0],value=entries[i][1];' +
    'var input=null;' +
    'for(var di=0;di<docs.length&&!input;di++){' +
    'var doc=docs[di];' +
    // 1. CSS selector
    'if(label.match(/^[#.\\[]/)){try{input=doc.querySelector(label);}catch(e){}}' +
    // 2. Exact ID/name match
    'if(!input){try{input=doc.getElementById(label);}catch(e){}}' +
    'if(!input){var byName=doc.querySelectorAll("[name=\\""+label+"\\"]");if(byName.length===1)input=byName[0];}' +
    // 3. <label> text matching (includes + fuzzy)
    'if(!input){' +
    'var labels=Array.from(doc.querySelectorAll("label"));' +
    'for(var j=0;j<labels.length;j++){' +
    'var lt=labels[j].textContent?labels[j].textContent.trim():"";' +
    'if(lt&&fuzzyMatch(lt,label)){' +
    'if(labels[j].htmlFor)input=doc.getElementById(labels[j].htmlFor);' +
    'if(!input)input=labels[j].querySelector("input,textarea,select");' +
    'break;}}}' +
    // 4. Attributes -- placeholder, aria-label
    'if(!input){' +
    'var safeLabel=label.replace(/["\\\\]/g,"");' +
    'if(safeLabel.length>0&&safeLabel.length<100){' +
    'try{input=doc.querySelector(' +
      '"input[placeholder*=\\""+safeLabel+"\\" i],' +
      'input[aria-label*=\\""+safeLabel+"\\" i],' +
      'textarea[placeholder*=\\""+safeLabel+"\\" i],' +
      'textarea[aria-label*=\\""+safeLabel+"\\" i],' +
      'select[aria-label*=\\""+safeLabel+"\\" i],' +
      '[data-placeholder*=\\""+safeLabel+"\\" i],' +
      '[aria-placeholder*=\\""+safeLabel+"\\" i]"' +
    ');}catch(e){}}}' +
    // 5. Nearby text -- walk all inputs, check with fuzzy matching
    'if(!input){' +
    'var allInputs=Array.from(doc.querySelectorAll("input:not([type=hidden]),textarea,select"));' +
    'for(var ai=0;ai<allInputs.length;ai++){' +
    'var nt=nearbyText(allInputs[ai]);' +
    'for(var ni=0;ni<nt.length;ni++){' +
    'if(fuzzyMatch(nt[ni],label)){input=allInputs[ai];break;}}' +
    'if(input)break;}}' +
    // 6. Contenteditable elements (DraftJS, ProseMirror, etc.)
    'if(!input){var ce=doc.querySelectorAll("[contenteditable=true],[role=textbox]");' +
    'for(var ci=0;ci<ce.length;ci++){' +
    'var ar=ce[ci].getAttribute("aria-label")||ce[ci].getAttribute("placeholder")||ce[ci].getAttribute("data-placeholder")||ce[ci].getAttribute("aria-placeholder")||"";' +
    'if(fuzzyMatch(ar,label)){input=ce[ci];break;}}}' +
    '}' +
    // Set value and verify
    'if(input){' +
    'if(input.type==="checkbox"){' +
    'input.checked=!!value;input.dispatchEvent(new Event("change",{bubbles:true}));' +
    'var ok=input.checked===!!value;filled.push(label+(ok?"":"⚠"));if(!ok)mismatched.push(label);}' +
    'else if(input.tagName==="SELECT"){' +
    'input.value=String(value);input.dispatchEvent(new Event("change",{bubbles:true}));' +
    'var ok2=input.value===String(value);filled.push(label+(ok2?"":"⚠"));if(!ok2)mismatched.push(label);}' +
    'else if(input.contentEditable==="true"||input.getAttribute("role")==="textbox"){' +
    'input.focus();document.execCommand("selectAll",false,null);document.execCommand("delete",false,null);document.execCommand("insertText",false,String(value));' +
    'filled.push(label);}' +
    'else{' +
    // Fix 4: Use native setter + InputEvent with insertText for React 18+ compatibility
    'input.focus();input.click();' +
    'var proto=input.tagName==="TEXTAREA"?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;' +
    'var nativeSetter=Object.getOwnPropertyDescriptor(proto,"value");' +
    'if(nativeSetter&&nativeSetter.set){nativeSetter.set.call(input,String(value));}else{input.value=String(value);}' +
    'input.dispatchEvent(new InputEvent("input",{bubbles:true,cancelable:true,inputType:"insertText",data:String(value)}));' +
    'input.dispatchEvent(new Event("change",{bubbles:true}));' +
    // Also try triggering React onChange via fiber if available
    'try{var fk=Object.keys(input).find(function(k){return k.startsWith("__reactProps$");});' +
    'if(fk&&input[fk]&&input[fk].onChange){input[fk].onChange({target:input,currentTarget:input});}}catch(e){}' +
    // Verify: read back the value after a microtask (React setState is async)
    'var expected=String(value).substring(0,30);var actual=(input.value||"").substring(0,30);' +
    'if(actual===expected||actual.length>0){filled.push(label);}' +
    'else{filled.push(label+"⚠");mismatched.push(label);}}' +
    '}}'
  if (submit) {
    code += 'var btns=null;' +
      'for(var di=0;di<docs.length&&!btns;di++){' +
      'var b=Array.from(docs[di].querySelectorAll("button[type=submit],input[type=submit],button"));' +
      'if(b.length)btns=b;}' +
      'if(btns&&btns[0]){btns[0].click();filled.push("[submitted]");}'
  }
  // Build result message
  code += 'var notFound=entries.filter(function(e){return filled.indexOf(e[0])===-1&&filled.indexOf(e[0]+"⚠")===-1;}).map(function(e){return e[0];});' +
    'var msg=filled.length?"Filled: "+filled.join(", "):"No fields matched";' +
    'if(mismatched.length)msg+="\\n⚠ Value mismatch (React may have overridden): "+mismatched.join(", ")+"\\nTip: use act type with CSS selector for these fields";' +
    'if(notFound.length)msg+="\\nNot found: "+notFound.join(", ")+"\\nTip: use page({detail:\\"a11y\\"}) to see field names, or act type with CSS selector";' +
    // Dynamic form re-scan: check if new fields appeared after filling
    'var fieldsAfter=document.querySelectorAll("input:not([type=hidden]),textarea,select").length;' +
    'if(fieldsAfter>fieldsBefore)msg+="\\n🔄 "+String(fieldsAfter-fieldsBefore)+" new field(s) appeared after filling (conditional form). Call page to see them.";' +
    'return msg;})()'
  return code
}

// ---------------------------------------------------------------------------
// buildReadCode — extract structured data from page
// ---------------------------------------------------------------------------
export function buildReadCode(scope: string, limit: number): string {
  return '(function(){' +
    'var scope=document.querySelector(' + JSON.stringify(scope) + ')||document.body;' +
    'var items=[];' +
    'var els=scope.querySelectorAll("li,article,.item,.result,.card,[class*=result],[class*=item],[class*=product],tr");' +
    'if(els.length>1){' +
    'Array.from(els).slice(0,' + limit + ').forEach(function(el,i){' +
    'var t=(el.textContent||"").trim().replace(/\\s+/g," ").substring(0,200);' +
    'if(t)items.push((i+1)+". "+t);' +
    '});}' +
    'if(items.length)return items.join("\\n");' +
    'return (scope.innerText||"").substring(0,2000).replace(/\\s+/g," ").trim()||"No content found";' +
    '})()'
}

// ---------------------------------------------------------------------------
// buildWaitForStableCode — MutationObserver-based DOM stability wait.
// Returns when no DOM changes for debounceMs, or after timeoutMs.
// ---------------------------------------------------------------------------
export function buildWaitForStableCode(debounceMs = 150, timeoutMs = 5000): string {
  return '(function(){return new Promise(function(resolve){' +
    'var timer=null;var done=false;' +
    'var obs=new MutationObserver(function(){' +
    'if(done)return;if(timer)clearTimeout(timer);' +
    'timer=setTimeout(function(){done=true;obs.disconnect();resolve("stable");},'+debounceMs+');});' +
    'obs.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});' +
    // Start the initial timer (in case no mutations happen at all)
    'timer=setTimeout(function(){done=true;obs.disconnect();resolve("stable (no changes)");},'+debounceMs+');' +
    // Hard timeout
    'setTimeout(function(){if(!done){done=true;obs.disconnect();resolve("timeout");}},'+timeoutMs+');' +
    '});})()'
}

// ---------------------------------------------------------------------------
// buildConsoleCapture — inject console capture into webview
// ---------------------------------------------------------------------------
export function buildConsoleCapture(): string {
  return '(function(){if(window.__oc_logs)return "already";window.__oc_logs=[];' +
    'var orig={log:console.log,warn:console.warn,error:console.error,info:console.info};' +
    '["log","warn","error","info"].forEach(function(t){' +
    'console[t]=function(){' +
    'window.__oc_logs.push({type:t,msg:Array.from(arguments).map(function(a){try{return typeof a==="object"?JSON.stringify(a):String(a)}catch(e){return String(a)}}).join(" "),ts:Date.now()});' +
    'if(window.__oc_logs.length>200)window.__oc_logs.shift();' +
    'orig[t].apply(console,arguments);};});' +
    'window.addEventListener("error",function(e){' +
    'window.__oc_logs.push({type:"error",msg:"Uncaught: "+(e.message||"")+" at "+(e.filename||"")+":"+(e.lineno||""),ts:Date.now()});});' +
    'window.addEventListener("unhandledrejection",function(e){' +
    'window.__oc_logs.push({type:"error",msg:"Unhandled promise rejection: "+String(e.reason),ts:Date.now()});});' +
    'return "injected";})()'
}

// ---------------------------------------------------------------------------
// gaussianDelay — human-like timing via Box-Muller transform
// ---------------------------------------------------------------------------
export async function gaussianDelay(minMs = 200, maxMs = 800): Promise<void> {
  // Box-Muller transform for gaussian distribution
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const mean = (minMs + maxMs) / 2
  const stddev = (maxMs - minMs) / 6
  const delay = Math.max(minMs, Math.min(maxMs, mean + z * stddev))
  await new Promise(r => setTimeout(r, delay))
}

// ---------------------------------------------------------------------------
// buildSlimStateCode — slim page state (~50-80 tokens), appended after actions
// ---------------------------------------------------------------------------
export function buildSlimStateCode(): string {
  return '(function(){' +
    'function vis(el){if(!el)return false;var r=el.getBoundingClientRect();return r.width>2&&r.height>2&&getComputedStyle(el).display!=="none";}' +
    'var f=Array.from(document.querySelectorAll("input:not([type=hidden]),textarea,select")).filter(vis).slice(0,8).map(function(el){' +
    'var n=(el.labels&&el.labels[0]?el.labels[0].textContent.trim():"")||el.placeholder||el.name||el.type;' +
    'var v=el.value?el.value.substring(0,15):"";return n.substring(0,15)+(v?"=\\""+v+"\\"":"");}).join(", ");' +
    'var b=Array.from(document.querySelectorAll("button,[role=button]")).filter(vis).slice(0,6).map(function(el){' +
    'return ((el.textContent||"").trim()||el.getAttribute("aria-label")||"").substring(0,20);}).filter(Boolean).join(", ");' +
    'return "State: "+location.href.substring(0,60)+(f?" | Fields: "+f:"")+(b?" | Buttons: "+b:"");' +
    '})()'
}

// ---------------------------------------------------------------------------
// buildPageCode — ref-tagged a11y snapshot (page description with numbered
// interactive elements)
// ---------------------------------------------------------------------------
export function buildPageCode(): string {
  return '(function(){' +
    'var p=[];window.__oculoRefs=[];var refN=0;' +
    // Visibility helper
    'function vis(el){if(!el)return false;var r=el.getBoundingClientRect();' +
    'if(r.width<2||r.height<2)return false;var s=getComputedStyle(el);' +
    'if(s.display==="none"||s.visibility==="hidden"||s.opacity==="0")return false;' +
    'if(r.bottom<0||r.top>window.innerHeight+100)return false;return true;}' +
    // URL and title
    'p.push("URL: "+location.href);' +
    'p.push("Title: "+document.title);' +
    // Headings
    'var h=Array.from(document.querySelectorAll("h1,h2,h3")).filter(vis);' +
    'if(h.length){p.push("\\nHeadings:");h.slice(0,5).forEach(function(x){' +
    'var t=x.textContent.trim().substring(0,50);if(t)p.push("  "+x.tagName+": "+t);});}' +
    // Form fields -- find human-readable label for each field
    'var allInp=Array.from(document.querySelectorAll("input:not([type=hidden]),textarea,select")).filter(vis);' +
    'var iframes=document.querySelectorAll("iframe");' +
    'for(var fi=0;fi<iframes.length;fi++){try{var idoc=iframes[fi].contentDocument;if(idoc){var iinp=Array.from(idoc.querySelectorAll("input:not([type=hidden]),textarea,select")).filter(vis);allInp=allInp.concat(iinp);};}catch(e){}}' +
    // Collect from shadow DOMs
    'function shadowInputs(root){' +
    'var all=root.querySelectorAll("*");' +
    'for(var si=0;si<all.length;si++){' +
    'if(!all[si].shadowRoot)continue;' +
    'var sr=all[si].shadowRoot;' +
    'var si2=Array.from(sr.querySelectorAll("input:not([type=hidden]),textarea,select")).filter(vis);' +
    'allInp=allInp.concat(si2);shadowInputs(sr);}}' +
    'try{shadowInputs(document);}catch(e){}' +
    'if(allInp.length){p.push("\\nForm fields:");' +
    'allInp.slice(0,15).forEach(function(el){' +
      // Get human-readable label: associated <label>, aria-label, placeholder, then nearby text
      'var label="";' +
      'if(el.labels&&el.labels[0])label=el.labels[0].textContent.trim();' +
      'if(!label&&el.id){var lb=document.querySelector("label[for=\\""+el.id+"\\"]");if(lb)label=lb.textContent.trim();}' +
      'if(!label)label=el.getAttribute("aria-label")||"";' +
      'if(!label)label=el.placeholder||"";' +
      // If still no label, check preceding sibling or parent text (common in React forms)
      'if(!label){' +
      'var prev=el.previousElementSibling;' +
      'if(prev){var pt=prev.textContent.trim();if(pt.length>1&&pt.length<100)label=pt;}' +
      '}' +
      'if(!label){' +
      'var par=el.parentElement;' +
      'if(par){var kids=Array.from(par.children);var idx=kids.indexOf(el);' +
      'for(var k=Math.max(0,idx-2);k<idx;k++){var kt=kids[k].textContent.trim();if(kt.length>1&&kt.length<100){label=kt;break;}}}}' +
      // Last resort: name (skip hex/generated IDs), then type
      'if(!label){var nm=el.name||"";if(nm&&nm.length<30&&!/^[0-9a-f]{10,}$/i.test(nm))label=nm;}' +
      'if(!label)label=el.type||"input";' +
      // Truncate long labels
      'label=label.substring(0,80);' +
      // Show selector for CSS targeting
      'var sel=el.id&&el.id.length<30?"#"+el.id:(el.name&&el.name.length<30?"[name=\\""+el.name+"\\"]":"");' +
      'var val=el.value?el.value.substring(0,30):"";' +
      'p.push("  "+label+(sel?" ("+sel+")":"")+(val?" = \\""+val+"\\"":""));' +
    '});}' +
    // Editable areas
    'var ce=Array.from(document.querySelectorAll("[contenteditable=true],div[role=textbox]")).filter(vis);' +
    'if(ce.length){p.push("\\nEditable areas:");ce.slice(0,3).forEach(function(el){' +
    'p.push("  "+(el.getAttribute("aria-label")||"textbox"));});}' +
    // Numbered interactive elements -- buttons and links combined
    'var actions=[];' +
    'Array.from(document.querySelectorAll("button,[role=button],input[type=submit]")).filter(vis).forEach(function(b){' +
    'var t=((b.textContent||"").trim()||b.value||b.getAttribute("aria-label")||"").substring(0,30);' +
    'if(!t)return;' +
    'var ctx="";if(t.length<10){var par=b.parentElement;' +
    'while(par&&par!==document.body){var pt=(par.textContent||"").trim().replace(/\\s+/g," ").substring(0,80);' +
    'if(pt.length>t.length+5&&pt!==t){ctx=" — \\""+pt.substring(0,50)+"\\"";break;}par=par.parentElement;}}' +
    'actions.push({el:b,text:"button: "+t+ctx});});' +
    'Array.from(document.querySelectorAll("a[href]")).filter(vis).slice(0,10).forEach(function(a){' +
    'var t=(a.textContent||"").trim().substring(0,30);' +
    'if(t)actions.push({el:a,text:"link: "+t});});' +
    'if(actions.length){p.push("\\nClickable (#N to click):");actions.forEach(function(a){' +
    'refN++;window.__oculoRefs.push(a.el);p.push("  #"+refN+" "+a.text);});}' +
    // Cross-origin iframes
    'var iframes2=document.querySelectorAll("iframe");' +
    'for(var fi=0;fi<iframes2.length;fi++){' +
    'var iframe=iframes2[fi];var src=iframe.src||"";' +
    'var rect=iframe.getBoundingClientRect();' +
    'if(rect.width<10||rect.height<10||rect.top>window.innerHeight||rect.bottom<0)continue;' +
    'try{iframe.contentDocument;continue;}catch(e){}' +
    'if(src.includes("accounts.google.com")||src.includes("gsi/button"))p.push("\\nGoogle Sign-In at x="+Math.round(rect.left+rect.width/2)+",y="+Math.round(rect.top+rect.height/2)+" — use clickAtPoint");' +
    'else if(src.includes("recaptcha")||src.includes("hcaptcha"))p.push("\\nCAPTCHA detected");' +
    'else p.push("\\nIframe: "+src.substring(0,60));' +
    '}' +
    // VOIX tag detection -- emerging standard for agent-readable web
    'var voixTools=document.querySelectorAll("tool");' +
    'var voixCtx=document.querySelectorAll("context");' +
    'if(voixTools.length||voixCtx.length){' +
    'p.push("\\nVOIX Agent Interface:");' +
    'Array.from(voixTools).slice(0,10).forEach(function(t){' +
    'var name=t.getAttribute("name")||"";var desc=t.getAttribute("description")||t.textContent.trim().substring(0,60);' +
    'if(name)p.push("  tool: "+name+(desc?" — "+desc:""));});' +
    'Array.from(voixCtx).slice(0,5).forEach(function(c){' +
    'var key=c.getAttribute("key")||"";var val=c.textContent.trim().substring(0,80);' +
    'if(key||val)p.push("  context: "+(key?key+": ":"")+val);});}' +
    // High-level page pattern detection
    'var patterns=[];' +
    // Search form: input[type=search] or input near a search button
    'var searchInput=document.querySelector("input[type=search],input[name*=search i],input[placeholder*=search i],input[aria-label*=search i]");' +
    'if(searchInput&&vis(searchInput))patterns.push("search(query) — type in search box and submit");' +
    // Login form: username + password fields
    'var passField=document.querySelector("input[type=password]");' +
    'if(passField&&vis(passField)){' +
    'var userField=document.querySelector("input[type=email],input[type=text][name*=user i],input[name*=email i],input[autocomplete=username]");' +
    'if(userField&&vis(userField))patterns.push("login(user, pass) — fill credentials and submit");}' +
    // Pagination
    'var nextBtn=document.querySelector("[aria-label*=next i],a:has(> [class*=next]),button:has(> [class*=next]),.pagination a:last-child,.next");' +
    'if(!nextBtn){var btns=Array.from(document.querySelectorAll("a,button")).filter(vis);' +
    'nextBtn=btns.find(function(b){var t=(b.textContent||"").trim().toLowerCase();return t==="next"||t==="next page"||t==="›"||t==="»";});}' +
    'if(nextBtn&&vis(nextBtn))patterns.push("nextPage() — click next/pagination button");' +
    // Filter/sort controls
    'var sortSelect=document.querySelector("select[name*=sort i],select[aria-label*=sort i]");' +
    'if(sortSelect&&vis(sortSelect))patterns.push("sort(option) — use sort dropdown");' +
    'var filterInputs=document.querySelectorAll("input[name*=filter i],select[name*=filter i],[role=listbox][aria-label*=filter i]");' +
    'if(filterInputs.length)patterns.push("filter(field, value) — use filter controls");' +
    'if(patterns.length){p.push("\\nPage actions (use run for efficiency):");' +
    'patterns.forEach(function(pa){p.push("  "+pa);});}' +
    'return p.join("\\n");' +
    '})()'
}

// ---------------------------------------------------------------------------
// buildFingerprintMatchCode — score all interactive elements against a stored
// fingerprint. Returns best-matching element's CSS selector if score > 30%.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// buildDeepQuerySelectorCode — deep querying across shadow DOMs and
// same-origin iframes. Installs window.__oculoDeepQuery(selector) and
// window.__oculoDeepQueryAll(selector).
// ---------------------------------------------------------------------------
export function buildDeepQuerySelectorCode(): string {
  return `
    (function() {
      function deepQuery(root, selector) {
        // Try direct query first
        var result = root.querySelector(selector);
        if (result) return result;

        // Search shadow DOMs
        var allElements = root.querySelectorAll('*');
        for (var i = 0; i < allElements.length; i++) {
          var el = allElements[i];
          if (el.shadowRoot) {
            result = deepQuery(el.shadowRoot, selector);
            if (result) return result;
          }
        }

        // Search same-origin iframes
        var iframes = root.querySelectorAll('iframe');
        for (var j = 0; j < iframes.length; j++) {
          try {
            var doc = iframes[j].contentDocument || iframes[j].contentWindow.document;
            if (doc) {
              result = deepQuery(doc, selector);
              if (result) return result;
            }
          } catch(e) { /* cross-origin, skip */ }
        }

        return null;
      }

      function deepQueryAll(root, selector) {
        var results = Array.from(root.querySelectorAll(selector));

        var allElements = root.querySelectorAll('*');
        for (var i = 0; i < allElements.length; i++) {
          var el = allElements[i];
          if (el.shadowRoot) {
            results = results.concat(deepQueryAll(el.shadowRoot, selector));
          }
        }

        var iframes = root.querySelectorAll('iframe');
        for (var j = 0; j < iframes.length; j++) {
          try {
            var doc = iframes[j].contentDocument || iframes[j].contentWindow.document;
            if (doc) {
              results = results.concat(deepQueryAll(doc, selector));
            }
          } catch(e) { /* cross-origin, skip */ }
        }

        return results;
      }

      window.__oculoDeepQuery = deepQuery.bind(null, document);
      window.__oculoDeepQueryAll = deepQueryAll.bind(null, document);
      return 'Deep query helpers installed';
    })()
  `.trim()
}

// ---------------------------------------------------------------------------
// buildFingerprintMatchCode — score all interactive elements against a stored
// fingerprint. Returns best-matching element's CSS selector if score > 30%.
// ---------------------------------------------------------------------------
export function buildFingerprintMatchCode(fp: ElementFingerprint): string {
  return '(function(){' +
    'var fp=' + JSON.stringify(fp) + ';' +
    fuzzyMatchCode() +
    'function tokenScore(a,b,max){' +
    'if(!a||!b)return 0;' +
    'a=a.toLowerCase();b=b.toLowerCase();' +
    'if(a===b)return max;' +
    'if(a.includes(b)||b.includes(a))return max*0.8;' +
    'var ta=a.split(/[\\s\\-_\\/]+/).filter(function(t){return t.length>2;});' +
    'var tb=b.split(/[\\s\\-_\\/]+/).filter(function(t){return t.length>2;});' +
    'if(!ta.length||!tb.length)return 0;' +
    'var m=0;for(var i=0;i<ta.length;i++){for(var j=0;j<tb.length;j++){if(ta[i]===tb[j])m++;}}' +
    'return Math.round(max*(m/Math.max(ta.length,tb.length)));}' +
    // getUniqueSelector helper
    'function getUniqueSelector(el){' +
    'if(el.id)return"#"+CSS.escape(el.id);' +
    'var path=[];var c=el;' +
    'while(c&&c!==document.body&&c!==document.documentElement){' +
    'var tag=c.tagName.toLowerCase();' +
    'if(c.id){path.unshift("#"+CSS.escape(c.id));break;}' +
    'var par=c.parentElement;' +
    'if(par){var sibs=Array.from(par.children).filter(function(s){return s.tagName===c.tagName;});' +
    'if(sibs.length>1){tag+=":nth-of-type("+(sibs.indexOf(c)+1)+")";}}' +
    'path.unshift(tag);c=c.parentElement;}' +
    'return path.join(" > ");}' +
    // Score each interactive element
    'var allEls=document.querySelectorAll("a,button,input,textarea,select,[role=button],[role=link],[role=textbox],[role=checkbox],[role=radio],[role=combobox],[role=tab],[role=menuitem],[role=switch],[role=option],[contenteditable=true]");' +
    'var best=null;var bestScore=0;' +
    'for(var i=0;i<allEls.length;i++){' +
    'var el=allEls[i];var score=0;' +
    // name (25)
    'var elName=(el.textContent||"").trim().substring(0,80);' +
    'score+=tokenScore(elName,fp.name,25);' +
    // role (20) -- compare tag-implied role
    'var elRole=el.getAttribute("role")||"";' +
    'if(!elRole){var tag=el.tagName.toLowerCase();' +
    'if(tag==="a")elRole="link";else if(tag==="button"||el.type==="submit"||el.type==="button")elRole="button";' +
    'else if(tag==="input"){var t=el.type||"text";if(t==="checkbox")elRole="checkbox";else if(t==="radio")elRole="radio";else elRole="textbox";}' +
    'else if(tag==="textarea")elRole="textbox";else if(tag==="select")elRole="combobox";}' +
    'if(elRole===fp.role)score+=20;' +
    // innerText (15)
    'if(fp.innerText)score+=tokenScore((el.innerText||"").trim().substring(0,80),fp.innerText,15);' +
    // tagName (10)
    'if(fp.tagName&&el.tagName.toLowerCase()===fp.tagName)score+=10;' +
    // href (10)
    'if(fp.href&&el.href===fp.href)score+=10;' +
    // ariaLabel (10)
    'var elAria=el.getAttribute("aria-label")||"";' +
    'if(fp.ariaLabel)score+=tokenScore(elAria,fp.ariaLabel,10);' +
    // classes (8)
    'if(fp.classes&&fp.classes.length){var ec=Array.from(el.classList||[]);var cm=0;' +
    'for(var ci=0;ci<fp.classes.length;ci++){if(ec.indexOf(fp.classes[ci])!==-1)cm++;}' +
    'score+=Math.round(8*(cm/fp.classes.length));}' +
    // placeholder (8)
    'var elPh=el.getAttribute("placeholder")||el.getAttribute("data-placeholder")||"";' +
    'if(fp.placeholder)score+=tokenScore(elPh,fp.placeholder,8);' +
    // inputType (7)
    'if(fp.inputType&&(el.type||"")===(fp.inputType))score+=7;' +
    // position proximity (5) -- within 100px
    'if(fp.boundingBox){var r=el.getBoundingClientRect();' +
    'var dx=Math.abs(r.x-fp.boundingBox.x);var dy=Math.abs(r.y-fp.boundingBox.y);' +
    'if(dx<100&&dy<100)score+=5;else if(dx<300&&dy<300)score+=2;}' +
    // parentRole (5)
    'if(fp.parentRole&&el.parentElement){var pr=el.parentElement.getAttribute("role")||"";' +
    'if(pr===fp.parentRole)score+=5;}' +
    'if(score>bestScore){bestScore=score;best=el;}}' +
    // Threshold: 30% of 123 max = 37 points
    'if(best&&bestScore>=37){return{found:true,selector:getUniqueSelector(best),score:bestScore};}' +
    'return{found:false,score:bestScore};' +
    '})()'
}
