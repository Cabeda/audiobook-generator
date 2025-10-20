#!/usr/bin/env node

/**
 * Manual test script to generate real audiobook files with the Kokoro model
 * This downloads the actual model (~82MB on first run) and generates MP3 and M4B files
 * 
 * Run with: node src/lib/test-real-generation.mjs
 */

import { generateVoice } from './kokoro/kokoroClient.ts'
import { concatenateAudioChapters } from './audioConcat.ts'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { Buffer } from 'node:buffer'
import process from 'node:process'

console.log('🎙️  Starting Real Audiobook Generation Test\n')
console.log('This will download the Kokoro-82M model (~82MB) if not cached\n')

// Test configuration
const testCases = [
  {
    name: 'Single Chapter MP3',
    chapters: [
      { text: 'This is the first chapter.', voice: 'af_bella' }
    ],
    format: 'mp3',
    bitrate: 192,
    filename: 'single-chapter.mp3'
  },
  {
    name: 'Two Chapters MP3',
    chapters: [
      { text: 'This is the first chapter.', voice: 'af_bella' },
      { text: 'This is the second chapter.', voice: 'af_bella' }
    ],
    format: 'mp3',
    bitrate: 192,
    filename: 'two-chapters.mp3'
  },
  {
    name: 'Single Chapter M4B',
    chapters: [
      { text: 'This is the first chapter.', voice: 'bm_george' }
    ],
    format: 'm4b',
    bitrate: 256,
    bookTitle: 'Test Audiobook',
    bookAuthor: 'Test Author',
    filename: 'single-chapter.m4b'
  },
  {
    name: 'Two Chapters M4B',
    chapters: [
      { text: 'This is the first chapter.', voice: 'bm_george' },
      { text: 'This is the second chapter.', voice: 'bm_george' }
    ],
    format: 'm4b',
    bitrate: 256,
    bookTitle: 'Complete Audiobook',
    bookAuthor: 'John Doe',
    filename: 'two-chapters.m4b'
  }
]

async function runTests() {
  const outputDir = join(process.cwd(), 'test-output')
  await mkdir(outputDir, { recursive: true })
  
  console.log(`📁 Output directory: ${outputDir}\n`)
  
  for (const testCase of testCases) {
    try {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`📝 Test: ${testCase.name}`)
      console.log(`${'='.repeat(60)}`)
      
      // Generate audio for each chapter
      const audioChapters = []
      for (let i = 0; i < testCase.chapters.length; i++) {
        const chapter = testCase.chapters[i]
        console.log(`\n🎤 Generating chapter ${i + 1}/${testCase.chapters.length}...`)
        console.log(`   Text: "${chapter.text}"`)
        console.log(`   Voice: ${chapter.voice}`)
        
        const startTime = Date.now()
        const audioBlob = await generateVoice({
          text: chapter.text,
          voice: chapter.voice
        })
        const duration = Date.now() - startTime
        
        console.log(`   ✅ Generated in ${duration}ms (${audioBlob.size} bytes)`)
        
        audioChapters.push({
          id: `ch${i + 1}`,
          title: `Chapter ${i + 1}`,
          blob: audioBlob
        })
      }
      
      // Concatenate and convert to target format
      console.log(`\n🔄 Converting to ${testCase.format.toUpperCase()}...`)
      const startTime = Date.now()
      
      const options = {
        format: testCase.format,
        bitrate: testCase.bitrate
      }
      
      if (testCase.bookTitle) {
        options.bookTitle = testCase.bookTitle
      }
      if (testCase.bookAuthor) {
        options.bookAuthor = testCase.bookAuthor
      }
      
      const finalBlob = await concatenateAudioChapters(audioChapters, options)
      const duration = Date.now() - startTime
      
      console.log(`   ✅ Converted in ${duration}ms (${finalBlob.size} bytes)`)
      
      // Save to file
      const outputPath = join(outputDir, testCase.filename)
      const arrayBuffer = await finalBlob.arrayBuffer()
      await writeFile(outputPath, Buffer.from(arrayBuffer))
      
      console.log(`\n💾 Saved: ${outputPath}`)
      console.log(`📊 File size: ${(finalBlob.size / 1024).toFixed(2)} KB`)
      console.log(`✅ Test passed!`)
      
    } catch (error) {
      console.error(`\n❌ Test failed:`, error.message)
      if (error.stack) {
        console.error(error.stack)
      }
    }
  }
  
  console.log(`\n${'='.repeat(60)}`)
  console.log('🎉 All tests completed!')
  console.log(`📁 Check the test-output/ directory for generated files`)
  console.log(`${'='.repeat(60)}\n`)
}

// Run the tests
runTests().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
