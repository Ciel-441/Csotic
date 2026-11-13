/**
 * Real-time Claude Code Scanner & Bridge for Csotic
 * Reads authentic sessions from ~/.claude/projects/ and credentials from ~/.claude/.credentials.json
 * 100% real data, 0 fake or mock values.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function cleanPromptText(raw) {
  if (!raw) return '';
  if (Array.isArray(raw)) {
    const firstText = raw.find(item => item && (item.type === 'text' || typeof item === 'string'));
    return cleanPromptText(firstText ? (firstText.text || firstText) : '');
  }
  if (typeof raw === 'object' && raw.text) {
    return cleanPromptText(raw.text);
  }
  let str = String(raw).trim();
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null)) {
      return cleanPromptText(parsed);
    }
  } catch {}
  str = str.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/gi, '');
  str = str.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '');
  str = str.replace(/^#+\s*/, '').trim();
  const firstLine = str.split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
  return firstLine.substring(0, 65).trim();
}

function parseSessionMessages(filePath) {
  const msgs = [];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let idx = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'user' && obj.message?.content) {
          const text = cleanPromptText(obj.message.content);
          if (text) {
            msgs.push({
              id: obj.uuid || `msg-${++idx}`,
              role: 'user',
              text: text,
              time: obj.timestamp ? new Date(obj.timestamp).toLocaleTimeString() : undefined
            });
          }
        } else if (obj.type === 'assistant' && obj.message?.content) {
          let text = '';
          let thinking = '';
          if (Array.isArray(obj.message.content)) {
            const textParts = [];
            for (const c of obj.message.content) {
              if (c.type === 'text') textParts.push(c.text);
              else if (c.type === 'thinking') thinking += (c.thinking || '') + '\n';
            }
            text = textParts.join('\n');
          } else if (typeof obj.message.content === 'string') {
            text = obj.message.content;
          }
          if (text || thinking) {
            msgs.push({
              id: obj.uuid || `msg-${++idx}`,
              role: 'assistant',
              text: text || '(Analysis / command output)',
              thinking: thinking ? thinking.trim() : undefined,
              time: obj.timestamp ? new Date(obj.timestamp).toLocaleTimeString() : undefined
            });
          }
        }
      } catch {}
    }
  } catch {}
  return msgs;
}

function scan() {
  const claudeHome = path.join(os.homedir(), '.claude');
  const credentialsPath = path.join(claudeHome, '.credentials.json');
  const projectsDir = path.join(claudeHome, 'projects');

  let authenticated = false;
  let account = {
    email: undefined,
    subscriptionType: undefined,
    orgName: undefined
  };

  // 1. Read credentials & usage
  if (fs.existsSync(credentialsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      if (creds?.claudeAiOauth?.accessToken) {
        authenticated = true;
      }
    } catch {}
  }

  const claudeJsonPath = path.join(os.homedir(), '.claude.json');
  let usage = null;
  if (fs.existsSync(claudeJsonPath)) {
    try {
      const cj = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
      if (cj?.cachedUsageUtilization?.utilization) {
        usage = cj.cachedUsageUtilization.utilization;
      }
    } catch {}
  }

  // 2. Read real sessions
  const sessions = [];
  if (fs.existsSync(projectsDir)) {
    try {
      const projectFolders = fs.readdirSync(projectsDir);
      for (const folder of projectFolders) {
        const folderPath = path.join(projectsDir, folder);
        try {
          if (!fs.statSync(folderPath).isDirectory()) continue;
          const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
          
          for (const file of files) {
            const filePath = path.join(folderPath, file);
            try {
              const stat = fs.statSync(filePath);
              const id = file.replace('.jsonl', '');
              const msgs = parseSessionMessages(filePath);
              
              const firstUserMsg = msgs.find(m => m.role === 'user');
              const title = firstUserMsg ? firstUserMsg.text : 'Claude Session';

              let group = 'Other Projects';
              const folderLower = folder.toLowerCase();
              if (folderLower.includes('csotic')) {
                group = 'Current Workspace';
              } else if (folderLower.includes('salivo')) {
                group = 'Salivo Project';
              } else if (folderLower.includes('codeui')) {
                group = 'CodeUI Project';
              }

              // Calculate relative time ago
              const diffMs = Date.now() - stat.mtimeMs;
              const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
              let timeAgo = '';
              if (diffHours < 1) timeAgo = 'Just now';
              else if (diffHours < 24) timeAgo = `${diffHours}h ago`;
              else {
                const diffDays = Math.floor(diffHours / 24);
                timeAgo = diffDays === 1 ? 'Yesterday' : `${diffDays}d ago`;
              }

              sessions.push({
                id,
                title,
                group,
                isLocal: true,
                timeAgo,
                createdAt: stat.mtimeMs,
                messages: msgs
              });
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }

  sessions.sort((a, b) => b.createdAt - a.createdAt);

  console.log(JSON.stringify({
    authenticated,
    account,
    usage,
    sessions
  }));
}

scan();
