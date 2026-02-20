# Model Switching & Voice Selection - Implementation Summary

## 🎯 Requirements

1. **Model switching mid-playback**: When user changes model in text reader settings, it should:
   - NOT stop playback immediately
   - Apply new model only when user clicks a segment
   - Stop current processing and start with new config

2. **Voice selection**: Users should be able to change voices in text reader settings

3. **Test coverage**: Ensure behavior can be replicated using E2E tests

## ✅ Implementation

### 1. Deferred Model Application

**File**: `src/components/TextReader.svelte`

**Changes**:

- Modified `handleModelChange()` to NOT reload chapter immediately
- Only syncs model with chapter settings (for Kokoro/Piper)
- New model is applied when user clicks a segment

```typescript
async function handleModelChange() {
  // Don't reload chapter immediately - just update local state
  // New model will be applied when user clicks a segment

  // For kokoro/piper, sync with chapter settings and store
  if (localModel !== 'web_speech' && chapter && bookId) {
    await updateChapterModel(bookId, chapter.id, localModel)
    modelStore.set(localModel)
  }
}
```

### 2. Model Change Detection on Segment Click

**File**: `src/components/TextReader.svelte`

**Changes**:

- Added model change detection in `handleContentClick()`
- When model differs from current, stops playback and reloads chapter
- Then plays from clicked segment with new model

```typescript
function handleContentClick(event: MouseEvent) {
  // ... segment click handling ...

  // Check if model has changed
  const currentModel = audioService.getCurrentModel()
  if (currentModel !== localModel) {
    // Stop current playback
    audioService.stop()

    // Reload chapter with new model
    await audioService.loadChapter(bookId, bookTitle, chapter, {
      voice,
      quantization,
      device,
      selectedModel: localModel,
      playbackSpeed: audioService.playbackSpeed,
    })

    // Play from clicked segment
    audioService.playFromSegment(index)
  }
}
```

### 3. Voice Selector in Settings

**File**: `src/components/TextReader.svelte`

**Changes**:

- Added voice selector dropdown in settings menu
- Shows appropriate voices based on selected model:
  - **Kokoro**: af_heart, af_bella, bf_emma, am_adam, bm_george
  - **Piper**: en_US-amy-medium, en_GB-alan-medium
  - **Web Speech**: Default browser voice
- Voice changes applied on next segment click

```svelte
<div class="setting-item">
  <label for="voice-select">Voice</label>
  <select id="voice-select" bind:value={voice} onchange={handleVoiceChange}>
    {#if localModel === 'kokoro'}
      <option value="af_heart">af_heart (Female American)</option>
      <!-- ... more voices ... -->
    {:else if localModel === 'piper'}
      <option value="en_US-amy-medium">Amy (US English)</option>
      <!-- ... more voices ... -->
    {:else}
      <option value="default">Default Browser Voice</option>
    {/if}
  </select>
  <span class="hint">Applied on next segment click</span>
</div>
```

### 4. getCurrentModel() Method

**File**: `src/lib/audioPlaybackService.svelte.ts`

**Changes**:

- Added public getter method to check current model
- Used by TextReader to detect model changes

```typescript
getCurrentModel(): 'kokoro' | 'piper' | 'web_speech' {
  return this.selectedModel
}
```

## 🧪 Test Coverage

### New E2E Tests

**File**: `e2e/text-reader-reliability.spec.ts`

1. **Model Switching Test** (`should switch models mid-playback and continue with new model`):
   - Opens reader with Kokoro model
   - Clicks segment to start playback
   - Switches to Web Speech in settings
   - Clicks another segment
   - Verifies Web Speech API was used

2. **Voice Selection Test** (`should allow voice changes in text reader settings`):
   - Opens reader
   - Opens settings menu
   - Verifies voice selector exists
   - Checks multiple voice options available
   - Changes voice successfully

### Test Results

```
✓ should switch models mid-playback and continue with new model (4.3s)
✓ should allow voice changes in text reader settings (2.2s)

2 passed (6.2s)
```

## 🎨 User Experience

### Before

- Changing model immediately stopped playback
- No way to change voices in text reader
- Jarring interruption when exploring settings

### After

- Model changes are deferred until user clicks a segment
- Voice selector available in settings menu
- Smooth transition: user controls when to apply changes
- Clear hint: "Applied on next segment click"

## 📋 Usage Flow

1. **User opens text reader** → Loads with default/saved model
2. **User clicks settings** → Opens settings menu
3. **User changes model** → Saved to settings, not applied yet
4. **User changes voice** → Saved to settings, not applied yet
5. **User closes settings** → Returns to reading
6. **User clicks any segment** → Stops current playback, reloads with new model/voice, plays clicked segment

## 🔧 Technical Details

### Model Change Flow

```
User changes model in settings
  ↓
handleModelChange() updates local state
  ↓
Syncs with chapter settings (Kokoro/Piper only)
  ↓
User clicks segment
  ↓
handleContentClick() detects model mismatch
  ↓
Stops current playback
  ↓
Reloads chapter with new model
  ↓
Plays from clicked segment
```

### Voice Change Flow

```
User changes voice in settings
  ↓
handleVoiceChange() updates voice variable
  ↓
User clicks segment
  ↓
If model changed: reloads with new voice
  ↓
If model same: uses new voice on next generation
```

## ✅ Verification

### Manual Testing

1. Start dev server: `pnpm dev`
2. Upload EPUB and open reader
3. Click segment to start playback
4. Open settings, change model to Web Speech
5. Close settings
6. Click another segment
7. **Expected**: Playback stops, restarts with Web Speech
8. Open settings, change voice
9. Click another segment
10. **Expected**: Uses new voice

### Automated Testing

```bash
pnpm test:e2e e2e/text-reader-reliability.spec.ts --grep "should switch models|should allow voice"
```

---

**Status**: Fully implemented ✅  
**Tests**: 2/2 passing ✅  
**Build**: No errors ✅  
**UX**: Smooth, user-controlled transitions ✅
