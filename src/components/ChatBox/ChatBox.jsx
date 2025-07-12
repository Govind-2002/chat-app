import React, { useContext, useEffect, useRef, useState } from "react";
import "./ChatBox.css";
import assets from "../../assets/assets";
import { AppContext } from "../../context/AppContext";
import { arrayUnion, doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../../config/firebase";
import { toast } from "react-toastify";
import upload from "../../lib/upload";

const ChatBox = () => {
  const {
    userData,
    messagesId,
    chatUser,
    messages,
    setMessages,
    chatVisible,
    setChatVisible,

    // Call context items:
    startVoiceCall,
    startVideoCall,
    hangUp,
    incomingCall,
    answerCall,
    call,
    localStream,
    remoteStream,
    isVideoCall,
    isVideoEnabled,
    isAudioEnabled,
    toggleVideo,
    toggleAudio,
    switchToVideoCall,
  } = useContext(AppContext);

  const [input, setInput] = useState("");
  const [showCallOptions, setShowCallOptions] = useState(false);
  const scrollEnd = useRef();
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const localAudioRef = useRef();
  const remoteAudioRef = useRef();

  // Attach streams to video/audio elements
  useEffect(() => {
    if (localStream) {
      if (isVideoCall && localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = localStream;
      }
    }
  }, [localStream, isVideoCall]);

  useEffect(() => {
    if (remoteStream) {
      if (isVideoCall && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
      }
    }
  }, [remoteStream, isVideoCall]);

  const sendMessage = async () => {
    try {
      if (input && messagesId) {
        await updateDoc(doc(db, "messages", messagesId), {
          messages: arrayUnion({
            sId: userData.id,
            text: input,
            createdAt: new Date(),
          }),
        });

        const userIDs = [chatUser.rId, userData.id];

        userIDs.forEach(async (id) => {
          const userChatsRef = doc(db, "chats", id);
          const userChatsSnapshot = await getDoc(userChatsRef);

          if (userChatsSnapshot.exists()) {
            const userChatsData = userChatsSnapshot.data();
            const chatIndex = userChatsData.chatsData.findIndex(
              (c) => c.messageId === messagesId
            );
            userChatsData.chatsData[chatIndex].lastMessage = input;
            userChatsData.chatsData[chatIndex].updatedAt = Date.now();
            if (userChatsData.chatsData[chatIndex].rId === userData.id) {
              userChatsData.chatsData[chatIndex].messageSeen = false;
            }
            await updateDoc(userChatsRef, {
              chatsData: userChatsData.chatsData,
            });
          }
        });
      }
    } catch (error) {
      toast.error(error.message);
    }
    setInput("");
  };

  const convertTimestamp = (timestamp) => {
    let date = timestamp.toDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    if (hour > 12) {
      return hour - 12 + ":" + (minute < 10 ? "0" + minute : minute) + " PM";
    } else {
      return hour + ":" + (minute < 10 ? "0" + minute : minute) + " AM";
    }
  };

  // Incoming Call Modal Component
  const IncomingCallModal = ({ callerName, isVideo, onAccept, onReject }) => {
    return (
      <div className="incoming-call-overlay">
        <div className="incoming-call-box">
          <div className="caller-info">
            <img 
              src={chatUser?.userData?.avatar || assets.profile_img} 
              alt="Caller" 
              className="caller-avatar"
            />
            <p>{callerName} is calling you</p>
            <p className="call-type">{isVideo ? 'Video Call' : 'Voice Call'}</p>
          </div>
          <div className="incoming-call-buttons">
            <button onClick={onAccept} className="accept-call-btn" title="Accept Call">
              {isVideo ? '📹' : '📞'}
            </button>
            <button onClick={onReject} className="reject-call-btn" title="Reject Call">
              ❌
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Video Call Interface Component
  const VideoCallInterface = () => {
    return (
      <div className="video-call-interface">
        <div className="video-container">
          {/* Remote video (main view) */}
          <div className="remote-video-container">
            {isVideoCall ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="remote-video"
              />
            ) : (
              <div className="audio-call-display">
                <img 
                  src={chatUser?.userData?.avatar || assets.profile_img} 
                  alt="Remote user" 
                  className="audio-call-avatar"
                />
                <p>{chatUser?.userData?.name}</p>
                <p className="call-status">Voice Call</p>
              </div>
            )}
          </div>

          {/* Local video (picture-in-picture) */}
          {isVideoCall && (
            <div className="local-video-container">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="local-video"
              />
            </div>
          )}
        </div>

        {/* Call controls */}
        <div className="call-controls">
          {/* Audio toggle */}
          <button
            onClick={toggleAudio}
            className={`control-btn ${isAudioEnabled ? 'active' : 'muted'}`}
            title={isAudioEnabled ? 'Mute' : 'Unmute'}
          >
            {isAudioEnabled ? '🎤' : '🔇'}
          </button>

          {/* Video toggle (only show if it's a video call) */}
          {isVideoCall && (
            <button
              onClick={toggleVideo}
              className={`control-btn ${isVideoEnabled ? 'active' : 'disabled'}`}
              title={isVideoEnabled ? 'Turn off video' : 'Turn on video'}
            >
              {isVideoEnabled ? '📹' : '📷'}
            </button>
          )}

          {/* Switch to video call (only show during voice calls) */}
          {!isVideoCall && (
            <button
              onClick={switchToVideoCall}
              className="control-btn"
              title="Switch to video call"
            >
              📹
            </button>
          )}

          {/* Hang up */}
          <button
            onClick={hangUp}
            className="control-btn hangup"
            title="Hang up"
          >
            📴
          </button>
        </div>
      </div>
    );
  };

  // Call Options Menu Component
  const CallOptionsMenu = () => {
    return (
      <div className="call-options-menu">
        <button
          onClick={() => {
            startVoiceCall(chatUser.rId);
            setShowCallOptions(false);
          }}
          className="call-option-btn"
        >
          📞 Voice Call
        </button>
        <button
          onClick={() => {
            startVideoCall(chatUser.rId);
            setShowCallOptions(false);
          }}
          className="call-option-btn"
        >
          📹 Video Call
        </button>
      </div>
    );
  };

  const sendImage = async (e) => {
    const fileUrl = await upload(e.target.files[0]);

    if (fileUrl && messagesId) {
      await updateDoc(doc(db, "messages", messagesId), {
        messages: arrayUnion({
          sId: userData.id,
          image: fileUrl,
          createdAt: new Date(),
        }),
      });

      const userIDs = [chatUser.rId, userData.id];

      userIDs.forEach(async (id) => {
        const userChatsRef = doc(db, "chats", id);
        const userChatsSnapshot = await getDoc(userChatsRef);

        if (userChatsSnapshot.exists()) {
          const userChatsData = userChatsSnapshot.data();
          const chatIndex = userChatsData.chatsData.findIndex(
            (c) => c.messageId === messagesId
          );
          userChatsData.chatsData[chatIndex].lastMessage = "Image";
          userChatsData.chatsData[chatIndex].updatedAt = Date.now();
          await updateDoc(userChatsRef, {
            chatsData: userChatsData.chatsData,
          });
        }
      });
    }
  };

  useEffect(() => {
    scrollEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (messagesId) {
      const unSub = onSnapshot(doc(db, "messages", messagesId), (res) => {
        setMessages(res.data().messages.reverse());
      });
      return () => {
        unSub();
      };
    }
  }, [messagesId]);

  // Accept incoming call
  const handleAnswerCall = () => {
    if (incomingCall && incomingCall.id) {
      answerCall(incomingCall.id);
    }
  };

  // Reject incoming call
  const handleRejectCall = () => {
    hangUp();
  };

  // Toggle call options menu
  const toggleCallOptions = () => {
    setShowCallOptions(!showCallOptions);
  };

  // Close call options when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showCallOptions && !event.target.closest('.call-section')) {
        setShowCallOptions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCallOptions]);

  return chatUser ? (
    <div className={`chat-box ${chatVisible ? "" : "hidden"}`}>
      {/* Show video call interface if there's an active call */}
      {call ? (
        <VideoCallInterface />
      ) : (
        <>
          {/* Regular chat interface */}
          <div className="chat-user">
            <img
              src={chatUser ? chatUser.userData.avatar : assets.profile_img}
              alt=""
            />
            <p>
              {chatUser ? chatUser.userData.name : "Richard Sanford"}{" "}
              {Date.now() - chatUser.userData.lastSeen <= 70000 ? (
                <img className="dot" src={assets.green_dot} alt="" />
              ) : null}
            </p>
            <img
              onClick={() => setChatVisible(false)}
              className="arrow"
              src={assets.arrow_icon}
              alt=""
            />
            <img className="help" src={assets.help_icon} alt="" />

            {/* Call controls */}
            {!incomingCall && (
              <div className="call-section">
                <button 
                  className="call-button" 
                  onClick={toggleCallOptions}
                  title="Call options"
                >
                  📞
                </button>
                {showCallOptions && <CallOptionsMenu />}
              </div>
            )}
          </div>

          {/* Incoming call modal */}
          {incomingCall && (
            <IncomingCallModal
              callerName={incomingCall.callerName || incomingCall.caller || "Unknown"}
              isVideo={incomingCall.isVideo || false}
              onAccept={handleAnswerCall}
              onReject={handleRejectCall}
            />
          )}

          {/* Messages */}
          <div className="chat-msg">
            <div ref={scrollEnd}></div>
            {messages.map((msg, index) => {
              return (
                <div
                  key={index}
                  className={msg.sId === userData.id ? "s-msg" : "r-msg"}
                >
                  {msg["image"] ? (
                    <img className="msg-img" src={msg["image"]} alt="" />
                  ) : (
                    <p className="msg">{msg["text"]}</p>
                  )}
                  <div>
                    <img
                      src={msg.sId === userData.id ? userData.avatar : chatUser.userData.avatar}
                      alt=""
                    />
                    <p>{convertTimestamp(msg.createdAt)}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Chat input */}
          <div className="chat-input">
            <input
              onKeyDown={(e) => (e.key === "Enter" ? sendMessage() : null)}
              onChange={(e) => setInput(e.target.value)}
              value={input}
              type="text"
              placeholder="Send a message"
            />
            <input
              onChange={sendImage}
              type="file"
              id="image"
              accept="image/png, image/jpeg"
              hidden
            />
            <label htmlFor="image">
              <img src={assets.gallery_icon} alt="" />
            </label>
            <img onClick={sendMessage} src={assets.send_button} alt="" />
          </div>
        </>
      )}

      {/* Hidden audio elements for audio streams */}
      <audio ref={localAudioRef} autoPlay muted />
      <audio ref={remoteAudioRef} autoPlay />
    </div>
  ) : (
    <div className={`chat-welcome ${chatVisible ? "" : "hidden"}`}>
      <img src={assets.logo_icon} alt="" />
      <p>Chat anytime, anywhere</p>
    </div>
  );
};

export default ChatBox;