import {
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  collection,
  setDoc,
  addDoc,
  deleteDoc,
} from "firebase/firestore";
import { createContext, useEffect, useState, useRef } from "react";
import { auth, db } from "../config/firebase";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";

export const AppContext = createContext();

const AppContextProvider = (props) => {
  const [userData, setUserData] = useState(null);
  const [chatData, setChatData] = useState(null);
  const [messagesId, setMessagesId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatUser, setChatUser] = useState(null);
  const [chatVisible, setChatVisible] = useState(false);
  const navigate = useNavigate();

  // Call related states
  const [call, setCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // Refs for WebRTC peer connection and call document id
  const peerConnection = useRef(null);
  const callDocId = useRef(null);
  const callTimerRef = useRef(null);

  // Enhanced ICE Servers configuration for better connectivity
  const servers = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
    ],
  };

  // Development mode detection
  const isDevelopment = process.env.NODE_ENV === 'development' || 
                       window.location.hostname === 'localhost' ||
                       window.location.hostname === '127.0.0.1';

  // Get optimized media constraints for testing
  const getMediaConstraints = (withVideo, isForTesting = false) => {
    const baseAudioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    if (!withVideo) {
      return { 
        audio: baseAudioConstraints,
        video: false 
      };
    }

    // Video constraints optimized for same-device testing
    const videoConstraints = isForTesting || isDevelopment ? {
      width: { ideal: 480, max: 640 },
      height: { ideal: 360, max: 480 },
      frameRate: { ideal: 15, max: 24 },
      facingMode: 'user',
    } : {
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 30 },
      facingMode: 'user',
    };

    return {
      audio: baseAudioConstraints,
      video: videoConstraints
    };
  };

  // Load user data
  const loadUserData = async (uid) => {
    try {
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.data();
      setUserData(userData);
      if (userData.avatar && userData.name) {
        navigate("/chat");
      } else {
        navigate("/profile");
      }
      await updateDoc(userRef, {
        lastSeen: Date.now(),
      });
      setInterval(async () => {
        if (auth.chatUser) {
          await updateDoc(userRef, {
            lastSeen: Date.now(),
          });
        }
      }, 60000);
    } catch (error) {
      toast.error(error.message);
    }
  };

  // Load chat data snapshot listener
  useEffect(() => {
    if (userData) {
      const chatRef = doc(db, "chats", userData.id);
      const unSub = onSnapshot(chatRef, async (res) => {
        const chatItems = res.data().chatsData;
        const tempData = [];
        for (const item of chatItems) {
          const userRef = doc(db, "users", item.rId);
          const userSnap = await getDoc(userRef);
          const userData = userSnap.data();
          tempData.push({ ...item, userData });
        }
        setChatData(tempData.sort((a, b) => b.updatedAt - a.updatedAt));
      });

      return () => {
        unSub();
      };
    }
  }, [userData]);

  // Periodic refresh for chat data
  useEffect(() => {
    if (userData) {
      const intervalId = setInterval(async () => {
        const chatRef = doc(db, "chats", userData.id);
        const data = await getDoc(chatRef);
        const chatItems = data.data().chatsData;
        const tempData = [];
        for (const item of chatItems) {
          const userRef = doc(db, "users", item.rId);
          const userSnap = await getDoc(userRef);
          const userData = userSnap.data();
          tempData.push({ ...item, userData });
        }
        setChatData(tempData.sort((a, b) => b.updatedAt - a.updatedAt));
      }, 10000);

      return () => clearInterval(intervalId);
    }
  }, [userData]);

  // Call duration timer
  useEffect(() => {
    if (call && !callTimerRef.current) {
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else if (!call && callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
      setCallDuration(0);
    }

    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, [call]);

  // ********* Enhanced Call Functions *********

  // Start a voice call
  const startVoiceCall = async (calleeId) => {
    await startCall(calleeId, false);
  };

  // Start a video call
  const startVideoCall = async (calleeId) => {
    await startCall(calleeId, true);
  };

  // Generic start call function with enhanced error handling
  const startCall = async (calleeId, withVideo = false) => {
    if (!userData) return;
    
    setIsConnecting(true);
    
    try {
      const callDoc = doc(db, "calls", calleeId);
      callDocId.current = calleeId;

      const offerCandidates = collection(callDoc, "callerCandidates");
      const answerCandidates = collection(callDoc, "calleeCandidates");

      peerConnection.current = new RTCPeerConnection(servers);

      // Enhanced media acquisition with multiple fallback attempts
      let stream;
      let actuallyUsingVideo = withVideo;

      if (withVideo) {
        try {
          // First attempt: Full video
          stream = await navigator.mediaDevices.getUserMedia(
            getMediaConstraints(true, isDevelopment)
          );
          console.log('✅ Video stream acquired successfully');
        } catch (videoError) {
          console.warn('❌ Video failed:', videoError.message);
          
          try {
            // Second attempt: Lower quality video
            stream = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true },
              video: { width: 320, height: 240, frameRate: 15 }
            });
            console.log('✅ Low-quality video stream acquired');
            toast.warning('Using lower quality video due to device limitations');
          } catch (lowVideoError) {
            console.warn('❌ Low-quality video failed:', lowVideoError.message);
            
            // Third attempt: Audio only
            stream = await navigator.mediaDevices.getUserMedia(
              getMediaConstraints(false)
            );
            actuallyUsingVideo = false;
            console.log('✅ Audio-only stream acquired as fallback');
            toast.warning('Camera not available, switching to audio-only call');
          }
        }
      } else {
        // Audio only call
        stream = await navigator.mediaDevices.getUserMedia(
          getMediaConstraints(false)
        );
        console.log('✅ Audio stream acquired');
      }

      setLocalStream(stream);
      setIsVideoCall(actuallyUsingVideo);
      setIsVideoEnabled(actuallyUsingVideo);
      setIsAudioEnabled(true);

      // Add tracks to peer connection
      stream.getTracks().forEach((track) => {
        console.log(`Adding ${track.kind} track:`, track.label);
        peerConnection.current.addTrack(track, stream);
      });

      // ICE candidate handling
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('🧊 Adding ICE candidate');
          addDoc(offerCandidates, event.candidate.toJSON()).catch(console.error);
        }
      };

      // Connection state monitoring
      peerConnection.current.onconnectionstatechange = () => {
        console.log('🔗 Connection state:', peerConnection.current.connectionState);
        if (peerConnection.current.connectionState === 'connected') {
          setIsConnecting(false);
          toast.success('Call connected!');
        } else if (peerConnection.current.connectionState === 'failed') {
          toast.error('Call connection failed');
          hangUp();
        }
      };

      // Remote stream handling
      const remoteMediaStream = new MediaStream();
      setRemoteStream(remoteMediaStream);
      
      peerConnection.current.ontrack = (event) => {
        console.log('📺 Received remote track:', event.track.kind);
        event.streams[0].getTracks().forEach((track) => {
          remoteMediaStream.addTrack(track);
        });
      };

      // Create and set offer
      const offerDescription = await peerConnection.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: actuallyUsingVideo,
      });
      await peerConnection.current.setLocalDescription(offerDescription);

      console.log('📤 Offer created and set');

      // Store call document
      await setDoc(callDoc, {
        caller: userData.id,
        callerName: userData.name,
        callee: calleeId,
        isVideo: actuallyUsingVideo,
        timestamp: Date.now(),
        offer: {
          type: offerDescription.type,
          sdp: offerDescription.sdp,
        },
      });

      console.log('📄 Call document created');

      // Listen for answer
      const unsubscribeAnswer = onSnapshot(callDoc, (snapshot) => {
        const data = snapshot.data();
        if (data?.answer && !peerConnection.current.currentRemoteDescription) {
          console.log('📥 Received answer');
          const answerDescription = new RTCSessionDescription(data.answer);
          peerConnection.current.setRemoteDescription(answerDescription);
          setCall(data);
        }
      });

      // Listen for ICE candidates from callee
      const unsubscribeCandidates = onSnapshot(answerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const candidate = new RTCIceCandidate(change.doc.data());
            peerConnection.current.addIceCandidate(candidate).catch(console.error);
          }
        });
      });

      // Store unsubscribe functions for cleanup
      peerConnection.current.unsubscribeAnswer = unsubscribeAnswer;
      peerConnection.current.unsubscribeCandidates = unsubscribeCandidates;

    } catch (error) {
      console.error('❌ Call start error:', error);
      setIsConnecting(false);
      
      if (error.name === 'NotAllowedError') {
        toast.error('Camera/microphone access denied. Please allow permissions and try again.');
      } else if (error.name === 'NotFoundError') {
        toast.error('Camera/microphone not found.');
      } else if (error.name === 'NotReadableError') {
        toast.error('Camera/microphone is being used by another application. Please close other apps and try again.');
      } else if (error.name === 'OverconstrainedError') {
        toast.error('Camera settings not supported by your device.');
      } else {
        toast.error('Error starting call: ' + error.message);
      }
    }
  };

  // Answer incoming call with enhanced error handling
  const answerCall = async (callId) => {
    if (!userData || !callId) return;
    
    setIsConnecting(true);
    
    try {
      const callDoc = doc(db, "calls", callId);
      const offerCandidates = collection(callDoc, "callerCandidates");
      const answerCandidates = collection(callDoc, "calleeCandidates");

      peerConnection.current = new RTCPeerConnection(servers);

      // Get call data
      const callDataDoc = await getDoc(callDoc);
      const callData = callDataDoc.data();
      let isVideoCallIncoming = callData.isVideo || false;

      console.log('📞 Answering call, video:', isVideoCallIncoming);

      // Enhanced media acquisition for answering
      let stream;
      let actuallyUsingVideo = isVideoCallIncoming;

      if (isVideoCallIncoming) {
        try {
          // Try video first
          stream = await navigator.mediaDevices.getUserMedia(
            getMediaConstraints(true, isDevelopment)
          );
          console.log('✅ Video stream acquired for answer');
        } catch (videoError) {
          console.warn('❌ Video failed for answer:', videoError.message);
          
          try {
            // Try lower quality
            stream = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true },
              video: { width: 320, height: 240, frameRate: 15 }
            });
            console.log('✅ Low-quality video stream acquired for answer');
            toast.warning('Using lower quality video');
          } catch (lowVideoError) {
            // Fallback to audio
            stream = await navigator.mediaDevices.getUserMedia(
              getMediaConstraints(false)
            );
            actuallyUsingVideo = false;
            console.log('✅ Audio-only stream acquired for answer');
            toast.warning('Camera not available, joining as audio-only');
          }
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia(
          getMediaConstraints(false)
        );
        console.log('✅ Audio stream acquired for answer');
      }

      setLocalStream(stream);
      setIsVideoCall(actuallyUsingVideo);
      setIsVideoEnabled(actuallyUsingVideo);
      setIsAudioEnabled(true);

      // Add tracks
      stream.getTracks().forEach((track) => {
        console.log(`Adding ${track.kind} track for answer:`, track.label);
        peerConnection.current.addTrack(track, stream);
      });

      // Remote stream setup
      const remoteMediaStream = new MediaStream();
      setRemoteStream(remoteMediaStream);
      
      peerConnection.current.ontrack = (event) => {
        console.log('📺 Received remote track in answer:', event.track.kind);
        event.streams[0].getTracks().forEach((track) => {
          remoteMediaStream.addTrack(track);
        });
      };

      // ICE candidates
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('🧊 Adding ICE candidate in answer');
          addDoc(answerCandidates, event.candidate.toJSON()).catch(console.error);
        }
      };

      // Connection state monitoring
      peerConnection.current.onconnectionstatechange = () => {
        console.log('🔗 Answer connection state:', peerConnection.current.connectionState);
        if (peerConnection.current.connectionState === 'connected') {
          setIsConnecting(false);
          toast.success('Call connected!');
        } else if (peerConnection.current.connectionState === 'failed') {
          toast.error('Call connection failed');
          hangUp();
        }
      };

      // Set remote description (offer)
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(callData.offer)
      );

      console.log('📥 Remote description set');

      // Create and set answer
      const answerDescription = await peerConnection.current.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: actuallyUsingVideo,
      });
      await peerConnection.current.setLocalDescription(answerDescription);

      console.log('📤 Answer created and set');

      // Update call document with answer
      await updateDoc(callDoc, {
        answer: {
          type: answerDescription.type,
          sdp: answerDescription.sdp,
        },
        answeredAt: Date.now(),
      });

      // Listen for ICE candidates from caller
      const unsubscribeCandidates = onSnapshot(offerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const candidate = new RTCIceCandidate(change.doc.data());
            peerConnection.current.addIceCandidate(candidate).catch(console.error);
          }
        });
      });

      peerConnection.current.unsubscribeCandidates = unsubscribeCandidates;

      setCall(callData);
      setIncomingCall(null);
      callDocId.current = callDoc.id;

    } catch (error) {
      console.error('❌ Answer call error:', error);
      setIsConnecting(false);
      
      if (error.name === 'NotAllowedError') {
        toast.error('Camera/microphone access denied.');
      } else if (error.name === 'NotReadableError') {
        toast.error('Camera/microphone is being used by another application.');
      } else {
        toast.error('Error answering call: ' + error.message);
      }
    }
  };

  // Enhanced toggle video function
  const toggleVideo = async () => {
    if (!localStream) return;

    try {
      const videoTrack = localStream.getVideoTracks()[0];
      
      if (videoTrack) {
        // Toggle existing video track
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
        console.log('📹 Video toggled:', videoTrack.enabled);
      } else if (!isVideoCall) {
        // Add video to audio-only call
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({ 
            video: getMediaConstraints(true, isDevelopment).video 
          });
          const newVideoTrack = videoStream.getVideoTracks()[0];
          
          localStream.addTrack(newVideoTrack);
          
          // Add to peer connection
          if (peerConnection.current) {
            peerConnection.current.addTrack(newVideoTrack, localStream);
          }
          
          setIsVideoCall(true);
          setIsVideoEnabled(true);
          console.log('📹 Video added to call');
          toast.success('Video enabled');
          
        } catch (error) {
          console.error('❌ Error adding video:', error);
          toast.error('Could not enable video: ' + error.message);
        }
      }
    } catch (error) {
      console.error('❌ Video toggle error:', error);
      toast.error('Error toggling video');
    }
  };

  // Enhanced toggle audio function
  const toggleAudio = () => {
    if (!localStream) return;

    try {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
        console.log('🎤 Audio toggled:', audioTrack.enabled);
        toast.info(audioTrack.enabled ? 'Microphone unmuted' : 'Microphone muted');
      }
    } catch (error) {
      console.error('❌ Audio toggle error:', error);
      toast.error('Error toggling audio');
    }
  };

  // Switch from voice to video call
  const switchToVideoCall = async () => {
    if (!localStream || !peerConnection.current || isVideoCall) return;
    
    try {
      console.log('📹 Switching to video call...');
      
      const videoStream = await navigator.mediaDevices.getUserMedia({ 
        video: getMediaConstraints(true, isDevelopment).video 
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      
      // Add video track to local stream
      localStream.addTrack(videoTrack);
      
      // Add to peer connection
      peerConnection.current.addTrack(videoTrack, localStream);
      
      setIsVideoCall(true);
      setIsVideoEnabled(true);
      
      // Update call document
      if (callDocId.current) {
        const callDoc = doc(db, "calls", callDocId.current);
        await updateDoc(callDoc, { isVideo: true });
      }
      
      console.log('✅ Successfully switched to video');
      toast.success('Video call enabled');
      
    } catch (error) {
      console.error('❌ Error switching to video:', error);
      toast.error('Could not switch to video: ' + error.message);
    }
  };

  // Enhanced hang up function
  const hangUp = async () => {
    try {
      console.log('📴 Hanging up call...');
      
      // Close peer connection
      if (peerConnection.current) {
        peerConnection.current.close();
        
        // Clean up listeners
        if (peerConnection.current.unsubscribeAnswer) {
          peerConnection.current.unsubscribeAnswer();
        }
        if (peerConnection.current.unsubscribeCandidates) {
          peerConnection.current.unsubscribeCandidates();
        }
        
        peerConnection.current = null;
      }

      // Stop all tracks
      localStream?.getTracks().forEach((track) => {
        track.stop();
        console.log(`🛑 Stopped ${track.kind} track`);
      });
      
      remoteStream?.getTracks().forEach((track) => {
        track.stop();
      });

      // Clear timer
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }

      // Reset states
      setLocalStream(null);
      setRemoteStream(null);
      setCall(null);
      setIncomingCall(null);
      setIsVideoCall(false);
      setIsVideoEnabled(true);
      setIsAudioEnabled(true);
      setIsConnecting(false);
      setCallDuration(0);

      // Delete call document
      if (callDocId.current) {
        const callDoc = doc(db, "calls", callDocId.current);
        await deleteDoc(callDoc);
        callDocId.current = null;
        console.log('🗑️ Call document deleted');
      }

      console.log('✅ Call ended successfully');
      
    } catch (error) {
      console.error('❌ Error hanging up:', error);
      toast.error('Error ending call: ' + error.message);
    }
  };

  // Listen for incoming calls
  useEffect(() => {
    if (!userData) return;

    const callDoc = doc(db, "calls", userData.id);

    const unsubscribe = onSnapshot(callDoc, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        console.log('📞 Incoming call detected:', data);
        
        // Only show incoming call if no active call
        if (!call && !incomingCall) {
          setIncomingCall({ id: docSnap.id, ...data });
        }
      } else {
        if (incomingCall && !call) {
          setIncomingCall(null);
        }
      }
    });

    return () => unsubscribe();
  }, [userData, call, incomingCall]);

  // Format call duration
  const formatCallDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Debug function for development
  const debugCallState = () => {
    if (isDevelopment) {
      console.log('🐛 Call Debug State:', {
        call: !!call,
        incomingCall: !!incomingCall,
        localStream: !!localStream,
        remoteStream: !!remoteStream,
        isVideoCall,
        isVideoEnabled,
        isAudioEnabled,
        isConnecting,
        callDuration,
        peerConnectionState: peerConnection.current?.connectionState,
        peerConnectionIceState: peerConnection.current?.iceConnectionState,
      });
    }
  };

  const value = {
    userData,
    setUserData,
    loadUserData,
    chatData,
    messagesId,
    setMessagesId,
    chatUser,
    setChatUser,
    chatVisible,
    setChatVisible,
    messages,
    setMessages,

    // Enhanced call exports
    call,
    incomingCall,
    localStream,
    remoteStream,
    isVideoCall,
    isVideoEnabled,
    isAudioEnabled,
    isConnecting,
    callDuration,
    formatCallDuration,
    startVoiceCall,
    startVideoCall,
    answerCall,
    hangUp,
    toggleVideo,
    toggleAudio,
    switchToVideoCall,
    debugCallState,
  };

  return (
    <AppContext.Provider value={value}>{props.children}</AppContext.Provider>
  );
};

export default AppContextProvider;