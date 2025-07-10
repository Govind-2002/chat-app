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

  // Voice call related states
  const [call, setCall] = useState(null); // Active call data
  const [incomingCall, setIncomingCall] = useState(null); // Incoming call info
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  // Refs for WebRTC peer connection and call document id
  const peerConnection = useRef(null);
  const callDocId = useRef(null);

  // ICE Servers configuration — using Google's public STUN
  const servers = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
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

  // ********* Voice Call Functions *********

  // Start a call by creating a call doc with calleeId as doc ID and making an offer SDP
  const startCall = async (calleeId) => {
    if (!userData) return;
    try {
      // Use calleeId as Firestore document ID for the call doc
      const callDoc = doc(db, "calls", calleeId);
      callDocId.current = calleeId;

      const offerCandidates = collection(callDoc, "callerCandidates");
      const answerCandidates = collection(callDoc, "calleeCandidates");

      peerConnection.current = new RTCPeerConnection(servers);

      // Get local audio stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);
      stream.getTracks().forEach((track) => {
        peerConnection.current.addTrack(track, stream);
      });

      // Add ICE candidates to Firestore as they are generated
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          addDoc(offerCandidates, event.candidate.toJSON());
        }
      };

      // Remote audio stream setup
      const remoteAudioStream = new MediaStream();
      setRemoteStream(remoteAudioStream);
      peerConnection.current.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => {
          remoteAudioStream.addTrack(track);
        });
      };

      // Create an offer SDP and set local description
      const offerDescription = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offerDescription);

      // Set call document with offer info and caller info
      await setDoc(callDoc, {
        caller: userData.id,
        callerName: userData.name,
        callee: calleeId,
        offer: {
          type: offerDescription.type,
          sdp: offerDescription.sdp,
        },
      });

      // Listen for answer SDP from callee
      onSnapshot(callDoc, (snapshot) => {
        const data = snapshot.data();
        if (data?.answer && !peerConnection.current.currentRemoteDescription) {
          const answerDescription = new RTCSessionDescription(data.answer);
          peerConnection.current.setRemoteDescription(answerDescription);
          setCall(data);
        }
      });

      // Listen for ICE candidates from callee
      onSnapshot(answerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const candidate = new RTCIceCandidate(change.doc.data());
            peerConnection.current.addIceCandidate(candidate);
          }
        });
      });
    } catch (error) {
      toast.error("Error starting call: " + error.message);
    }
  };

  // Answer an incoming call by setting remote offer and creating answer SDP
  const answerCall = async (callId) => {
    if (!userData || !callId) return;
    try {
      const callDoc = doc(db, "calls", callId);
      const offerCandidates = collection(callDoc, "callerCandidates");
      const answerCandidates = collection(callDoc, "calleeCandidates");

      peerConnection.current = new RTCPeerConnection(servers);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);
      stream.getTracks().forEach((track) => {
        peerConnection.current.addTrack(track, stream);
      });

      const remoteAudioStream = new MediaStream();
      setRemoteStream(remoteAudioStream);
      peerConnection.current.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => {
          remoteAudioStream.addTrack(track);
        });
      };

      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          addDoc(answerCandidates, event.candidate.toJSON());
        }
      };

      // Fetch call data (the offer SDP)
      const callDataDoc = await getDoc(callDoc);

      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(callDataDoc.data().offer)
      );

      // Create answer SDP and set local description
      const answerDescription = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answerDescription);

      await updateDoc(callDoc, {
        answer: {
          type: answerDescription.type,
          sdp: answerDescription.sdp,
        },
      });

      // Listen for ICE candidates from caller
      onSnapshot(offerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const candidate = new RTCIceCandidate(change.doc.data());
            peerConnection.current.addIceCandidate(candidate);
          }
        });
      });

      setCall(callDataDoc.data());
      setIncomingCall(null);
      callDocId.current = callDoc.id;
    } catch (error) {
      toast.error("Error answering call: " + error.message);
    }
  };

  // Hang up the call, close connections, stop streams and delete call doc
  const hangUp = async () => {
    try {
      peerConnection.current?.close();
      peerConnection.current = null;

      localStream?.getTracks().forEach((track) => track.stop());
      remoteStream?.getTracks().forEach((track) => track.stop());

      setLocalStream(null);
      setRemoteStream(null);

      setCall(null);
      setIncomingCall(null);

      if (callDocId.current) {
        const callDoc = doc(db, "calls", callDocId.current);
        await deleteDoc(callDoc);
        callDocId.current = null;
      }
    } catch (error) {
      toast.error("Error hanging up call: " + error.message);
    }
  };

  // Listen for incoming calls on the call doc with callee ID (userData.id)
  useEffect(() => {
    if (!userData) return;

    const callDoc = doc(db, "calls", userData.id);

    const unsubscribe = onSnapshot(callDoc, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        // Only show incoming call if no active call or incomingCall state
        if (!call && !incomingCall) {
          setIncomingCall({ id: docSnap.id, ...data });
        }
      } else {
        setIncomingCall(null);
      }
    });

    return () => unsubscribe();
  }, [userData, call, incomingCall]);

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

    // Voice call exports
    call,
    incomingCall,
    localStream,
    remoteStream,
    startCall,
    answerCall,
    hangUp,
  };

  return (
    <AppContext.Provider value={value}>{props.children}</AppContext.Provider>
  );
};

export default AppContextProvider;