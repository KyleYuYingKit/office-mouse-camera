import React, { useRef, useState, useEffect, useCallback } from 'react'
import './App.css'

const SEGMENT_DURATION_MS = 3_600_000 // 1 hour
const LOW_QUALITY_BITRATE = 250_000 // 250 kbps

function App() {
  const videoRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isCameraOn, setIsCameraOn] = useState(false)
  const [recordedChunks, setRecordedChunks] = useState([])
  const [isCompressing, setIsCompressing] = useState(false)
  const [compressionProgress, setCompressionProgress] = useState(0)
  const [originalSize, setOriginalSize] = useState(0)
  const [compressedSize, setCompressedSize] = useState(0)

  // Continuous low-quality recording state
  const continuousRecorderRef = useRef(null)
  const continuousIntervalRef = useRef(null)
  const segmentCountRef = useRef(0)
  const [isContinuousRecording, setIsContinuousRecording] = useState(false)
  const [segmentCount, setSegmentCount] = useState(0)
  const [elapsedTime, setElapsedTime] = useState(0)
  const elapsedIntervalRef = useRef(null)

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      })
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setIsCameraOn(true)
      }
    } catch (err) {
      console.error('Error accessing camera:', err)
      alert('Unable to access camera. Please ensure you have granted camera permissions.')
    }
  }

  const stopCamera = () => {
    if (isContinuousRecording) {
      stopContinuousRecording()
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject
      const tracks = stream.getTracks()
      tracks.forEach(track => track.stop())
      videoRef.current.srcObject = null
      setIsCameraOn(false)
      setIsRecording(false)
    }
  }

  const startRecording = () => {
    if (!videoRef.current || !videoRef.current.srcObject) {
      alert('Please start the camera first')
      return
    }

    const stream = videoRef.current.srcObject
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8,opus'
    })

    mediaRecorderRef.current = mediaRecorder
    const chunks = []

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data)
      }
    }

    mediaRecorder.onstop = () => {
      setRecordedChunks(chunks)
    }

    mediaRecorder.start()
    setIsRecording(true)
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const compressAndDownload = async () => {
    if (recordedChunks.length === 0) {
      alert('No recording available to download')
      return
    }

    setIsCompressing(true)
    setCompressionProgress(0)

    const originalBlob = new Blob(recordedChunks, { type: 'video/webm' })
    setOriginalSize(originalBlob.size)

    try {
      const compressedBlob = await reEncodeVideo(originalBlob)
      setCompressedSize(compressedBlob.size)

      const url = URL.createObjectURL(compressedBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `recording-${Date.now()}.webm`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Compression failed:', err)
      alert('Compression failed. Downloading original instead.')
      const url = URL.createObjectURL(originalBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `recording-${Date.now()}.webm`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setIsCompressing(false)
    }
  }

  const reEncodeVideo = (blob) => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const compressedChunks = []

      video.muted = true
      video.src = URL.createObjectURL(blob)

      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight

        const canvasStream = canvas.captureStream(30)
        const recorder = new MediaRecorder(canvasStream, {
          mimeType: 'video/webm;codecs=vp8',
          videoBitsPerSecond: 1_000_000 // 1 Mbps compressed
        })

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) compressedChunks.push(e.data)
        }

        recorder.onstop = () => {
          URL.revokeObjectURL(video.src)
          const compressedBlob = new Blob(compressedChunks, { type: 'video/webm' })
          resolve(compressedBlob)
        }

        recorder.onerror = (e) => reject(e.error)

        const duration = video.duration

        const drawFrame = () => {
          if (video.paused || video.ended) return
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          if (duration && isFinite(duration)) {
            setCompressionProgress(Math.round((video.currentTime / duration) * 100))
          }
          requestAnimationFrame(drawFrame)
        }

        video.onended = () => {
          setCompressionProgress(100)
          recorder.stop()
        }

        recorder.start()
        video.play()
        drawFrame()
      }

      video.onerror = () => {
        URL.revokeObjectURL(video.src)
        reject(new Error('Failed to load video for compression'))
      }
    })
  }

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const startContinuousRecording = () => {
    if (!videoRef.current || !videoRef.current.srcObject) {
      alert('Please start the camera first')
      return
    }

    segmentCountRef.current = 0
    setSegmentCount(0)
    setElapsedTime(0)

    startNewSegment()

    // Timer for elapsed display
    elapsedIntervalRef.current = setInterval(() => {
      setElapsedTime(prev => prev + 1)
    }, 1000)

    setIsContinuousRecording(true)
  }

  const startNewSegment = () => {
    const stream = videoRef.current.srcObject
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8,opus',
      videoBitsPerSecond: LOW_QUALITY_BITRATE
    })

    const chunks = []

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    recorder.onstop = () => {
      if (chunks.length > 0) {
        segmentCountRef.current += 1
        setSegmentCount(segmentCountRef.current)
        const blob = new Blob(chunks, { type: 'video/webm' })
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        downloadBlob(blob, `segment-${segmentCountRef.current}-${timestamp}.webm`)
      }
    }

    continuousRecorderRef.current = recorder
    recorder.start()

    // Schedule stopping this segment and starting a new one
    continuousIntervalRef.current = setTimeout(() => {
      if (continuousRecorderRef.current && continuousRecorderRef.current.state === 'recording') {
        continuousRecorderRef.current.stop()
        // Start the next segment
        startNewSegment()
      }
    }, SEGMENT_DURATION_MS)
  }

  const stopContinuousRecording = () => {
    if (continuousIntervalRef.current) {
      clearTimeout(continuousIntervalRef.current)
      continuousIntervalRef.current = null
    }
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current)
      elapsedIntervalRef.current = null
    }
    if (continuousRecorderRef.current && continuousRecorderRef.current.state === 'recording') {
      continuousRecorderRef.current.stop() // triggers final download
    }
    continuousRecorderRef.current = null
    setIsContinuousRecording(false)
  }

  useEffect(() => {
    return () => {
      stopCamera()
      if (continuousIntervalRef.current) clearTimeout(continuousIntervalRef.current)
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
    }
  }, [])

  return (
    <div className="App">
      <h1>Office Mouse Camera</h1>
      
      <div className="video-container">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted
          className="video-feed"
        />
      </div>

      <div className="controls">
        {!isCameraOn ? (
          <button onClick={startCamera} className="btn btn-primary">
            Start Camera
          </button>
        ) : (
          <button onClick={stopCamera} className="btn btn-danger">
            Stop Camera
          </button>
        )}

        {isCameraOn && !isRecording && !isContinuousRecording && (
          <button onClick={startRecording} className="btn btn-success">
            Start Recording
          </button>
        )}

        {isRecording && (
          <button onClick={stopRecording} className="btn btn-warning">
            Stop Recording
          </button>
        )}

        {isCameraOn && !isRecording && !isContinuousRecording && (
          <button onClick={startContinuousRecording} className="btn btn-continuous">
            Low-Q Auto Record
          </button>
        )}

        {isContinuousRecording && (
          <button onClick={stopContinuousRecording} className="btn btn-warning">
            Stop Auto Record
          </button>
        )}

        {recordedChunks.length > 0 && !isRecording && (
          <button 
            onClick={compressAndDownload} 
            className="btn btn-info"
            disabled={isCompressing}
          >
            {isCompressing ? 'Compressing...' : 'Compress & Download'}
          </button>
        )}
      </div>

      {isRecording && (
        <div className="recording-indicator">
          <span className="recording-dot"></span>
          Recording...
        </div>
      )}

      {isContinuousRecording && (
        <div className="continuous-status">
          <div className="recording-indicator">
            <span className="recording-dot continuous-dot"></span>
            Low-Quality Auto Recording
          </div>
          <div className="continuous-info">
            <p>Elapsed: {formatTime(elapsedTime)}</p>
            <p>Segments downloaded: {segmentCount}</p>
            <p>Next download in: {formatTime(3600 - (elapsedTime % 3600))}</p>
            <p className="bitrate-info">Bitrate: {LOW_QUALITY_BITRATE / 1000} kbps</p>
          </div>
        </div>
      )}

      {isCompressing && (
        <div className="compression-status">
          <div className="progress-bar-container">
            <div 
              className="progress-bar-fill" 
              style={{ width: `${compressionProgress}%` }}
            />
          </div>
          <p>Compressing: {compressionProgress}%</p>
        </div>
      )}

      {compressedSize > 0 && !isCompressing && (
        <div className="compression-result">
          <p>Original: {formatSize(originalSize)} → Compressed: {formatSize(compressedSize)}</p>
          <p>Saved: {((1 - compressedSize / originalSize) * 100).toFixed(1)}%</p>
        </div>
      )}
    </div>
  )
}

export default App
