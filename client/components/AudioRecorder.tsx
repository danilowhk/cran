'use client';

import { Button } from '@/components/ui/button';
import { MicIcon } from 'lucide-react';
import { useAudioRecorder } from '@/hooks/use-audio';
import {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';

interface AudioRecorderProps {
  onRecordingChange: (isRecording: boolean) => void;
  onAudioData?: (data: number[]) => void;
  onAudioReady?: (audioUrl: string) => void;
}

export const AudioRecorder = forwardRef<
  {
    stopAndReset: () => void;
    getAudioUrl: () => string | null;
  },
  AudioRecorderProps
>(({ onRecordingChange, onAudioData, onAudioReady }, ref) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [localAudioData, setLocalAudioData] = useState<number[]>(
    new Array(16).fill(128),
  );
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);

  // Clean up audio resources
  const cleanupAudio = () => {
    // Cancel any animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop all tracks in the media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Close the audio context
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (err) {
        console.error('Error closing AudioContext:', err);
      }
      audioContextRef.current = null;
    }

    analyserRef.current = null;

    // Reset visualization data
    const emptyData = new Array(16).fill(128);
    setLocalAudioData(emptyData);
    if (onAudioData) {
      onAudioData(emptyData);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return cleanupAudio;
  }, []);

  // Setup fake audio data for visualization when real audio can't be used
  const setupFakeAudioData = () => {
    const generateRandomData = () => {
      const newData = Array(16)
        .fill(0)
        .map(() => Math.floor(Math.random() * 50) + 100);
      setLocalAudioData(newData);
      if (onAudioData) {
        onAudioData(newData);
      }

      animationFrameRef.current = requestAnimationFrame(generateRandomData);
    };

    animationFrameRef.current = requestAnimationFrame(generateRandomData);
  };

  const startAudioAnalysis = async () => {
    try {
      // Clean up any existing audio resources
      cleanupAudio();

      // First check for browser compatibility
      if (
        typeof window === 'undefined' ||
        (!window.AudioContext && !(window as any).webkitAudioContext)
      ) {
        console.log('AudioContext not supported, using fallback visualization');
        setupFakeAudioData();
        onRecordingChange(true);
        return;
      }

      // Try to create the audio context
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass();

      // Check for microphone permissions by attempting to get the stream
      try {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        onRecordingChange(true);
      } catch (streamError) {
        console.log('Microphone access denied or error:', streamError);
        setupFakeAudioData();
        onRecordingChange(true);
        return;
      }

      // If we got this far, we have an audio context and a media stream
      if (audioContextRef.current && mediaStreamRef.current) {
        // Create the analyzer
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 32;
        analyserRef.current.smoothingTimeConstant = 0.5;

        // Create media stream source and connect
        const source = audioContextRef.current.createMediaStreamSource(
          mediaStreamRef.current,
        );
        source.connect(analyserRef.current);

        // Setup animation frame loop for getting audio data
        const updateWaveform = () => {
          if (!analyserRef.current) return;

          const dataArray = new Uint8Array(
            analyserRef.current.frequencyBinCount,
          );
          analyserRef.current.getByteTimeDomainData(dataArray);

          const audioDataArray = Array.from(dataArray);
          setLocalAudioData(audioDataArray);

          if (onAudioData) {
            onAudioData(audioDataArray);
          }

          animationFrameRef.current = requestAnimationFrame(updateWaveform);
        };

        animationFrameRef.current = requestAnimationFrame(updateWaveform);
      } else {
        // Fallback to fake visualization if we couldn't set up the audio pipeline
        console.log('Could not set up complete audio pipeline, using fallback');
        setupFakeAudioData();
      }
    } catch (error) {
      console.error('Error in audio setup:', error);
      setupFakeAudioData();
    }
  };

  const handleUpload = async (audioBlob: Blob) => {
    if (!audioBlob) {
      console.log('No audio blob to upload');
      return;
    }

    // Create object URL for local playback
    const audioUrl = URL.createObjectURL(audioBlob);
    setCurrentAudioUrl(audioUrl);

    // Notify parent component
    if (onAudioReady) {
      onAudioReady(audioUrl);
    }

    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.mp3');

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      if (response.ok) {
        console.log('Audio uploaded successfully');
      } else {
        console.error('Upload failed:', response.statusText);
      }
    } catch (error) {
      console.error('Upload error:', error);
    }
  };

  const { isRecording, toggleRecording: hookToggleRecording } =
    useAudioRecorder(handleUpload);

  // Effect to manage recording state changes
  useEffect(() => {
    if (isRecording) {
      startAudioAnalysis();
      // Reset audio URL when starting a new recording
      setCurrentAudioUrl(null);
    } else {
      cleanupAudio();
      onRecordingChange(false);
    }
  }, [isRecording]);

  const toggleRecording = () => {
    hookToggleRecording();
  };

  // Function to stop recording and reset state
  const stopAndReset = () => {
    if (isRecording) {
      hookToggleRecording(); // Stop the recording via the hook
      cleanupAudio();
    }
  };

  // Function to get the current audio URL
  const getAudioUrl = () => {
    return currentAudioUrl;
  };

  // Expose methods through ref
  useImperativeHandle(ref, () => ({
    stopAndReset,
    getAudioUrl,
  }));

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleRecording}
      className={isRecording ? 'ring-2 ring-red-500' : ''}
    >
      <MicIcon
        className={`h-4 w-4 ${isRecording ? 'text-red-500 animate-pulse' : 'text-blue-500'}`}
      />
      <span className="sr-only">
        {isRecording ? 'Stop' : 'Start'} recording
      </span>
    </Button>
  );
});

AudioRecorder.displayName = 'AudioRecorder';

export default AudioRecorder;
