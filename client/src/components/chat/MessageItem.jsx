import { useState, useContext, useEffect } from 'react';
import { Avatar, Box, IconButton, Menu, MenuItem, Typography, Paper } from '@mui/material';
import { 
  MoreVert as MoreVertIcon, 
  Delete as DeleteIcon,
  DoneAll as DoneAllIcon,
  Done as DoneIcon,
  AccessTime as AccessTimeIcon 
} from '@mui/icons-material';
import { format } from 'date-fns';
import { deleteMessage } from '../../api/messageApi';
import AttachmentPreview from './AttachmentPreview';
import { ChatContext } from '../../context/ChatContext';

const MessageItem = ({ message, showSender, onMessageDeleted }) => {
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { user } = useContext(ChatContext);
  
  // Debug: Add logging to verify user and message data
  useEffect(() => {
    console.log("MessageItem - User ID:", user?._id);
    console.log("MessageItem - Message Sender ID:", message.sender?._id);
    console.log("MessageItem - Message:", message);
  }, [message, user]);
  
  // Format message time
  const formatMessageTime = (timestamp) => {
    return format(new Date(timestamp), 'h:mm a');
  };
  
  // Handle menu open/close
  const handleMenuOpen = (event) => {
    event.stopPropagation();
    setMenuAnchorEl(event.currentTarget);
  };
  
  const handleMenuClose = () => {
    setMenuAnchorEl(null);
  };
  
  // Handle message deletion
  const handleDeleteMessage = async () => {
    try {
      setDeleting(true);
      await deleteMessage(message._id);
      
      // Notify parent component about the deleted message
      if (typeof onMessageDeleted === 'function') {
        onMessageDeleted(message._id);
      }
      
      handleMenuClose();
    } catch (error) {
      console.error('Error deleting message:', error);
      alert('Failed to delete message');
    } finally {
      setDeleting(false);
    }
  };
  
  // Determine if message is from current user
  const isSentByCurrentUser = user && message.sender && user._id === message.sender._id;
  console.log("isSentByCurrentUser:", isSentByCurrentUser, user?._id, message.sender?._id);
  
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isSentByCurrentUser ? 'row-reverse' : 'row',
        mb: 1.5,
        maxWidth: '80%',
        width: 'fit-content',
        alignSelf: isSentByCurrentUser ? 'flex-end' : 'flex-start',
        marginLeft: isSentByCurrentUser ? 'auto' : '0px',
        marginRight: isSentByCurrentUser ? '0px' : 'auto'
      }}
    >
      {showSender && !isSentByCurrentUser && (
        <Avatar
          sx={{ width: 32, height: 32, mr: 1, mt: 0.5 }}
        >
          {message.sender?.name?.charAt(0).toUpperCase() || '?'}
        </Avatar>
      )}
      
      <Box sx={{ maxWidth: '100%' }}>
        {showSender && !isSentByCurrentUser && (
          <Typography 
            variant="caption" 
            color="text.secondary"
            sx={{ ml: 1, display: 'block', mb: 0.5 }}
          >
            {message.sender?.name || 'Unknown User'}
          </Typography>
        )}
        
        <Paper
          elevation={1}
          sx={{
            p: 1.5,
            borderRadius: 2,
            bgcolor: isSentByCurrentUser ? 'primary.main' : 'background.paper',
            color: isSentByCurrentUser ? 'primary.contrastText' : 'text.primary',
            position: 'relative',
            wordBreak: 'break-word',
            maxWidth: '100%',
            minWidth: '120px',
            borderTopRightRadius: isSentByCurrentUser ? 0 : 2,
            borderTopLeftRadius: isSentByCurrentUser ? 2 : 0
          }}
        >
          {message.content && (
            <Typography variant="body2">{message.content}</Typography>
          )}
          
          {message.attachments && message.attachments.length > 0 && (
            <Box sx={{ mt: message.content ? 1.5 : 0 }}>
              {message.attachments.map((attachment, index) => (
                <AttachmentPreview key={index} attachment={attachment} />
              ))}
            </Box>
          )}
          
          <Box 
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              mt: 0.5,
              gap: 0.5,
              alignItems: 'center'
            }}
          >
            {/* Message status indicators (only for own messages) */}
            {isSentByCurrentUser && (
              <Box 
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  color: message.readBy?.length > 0 ? 'primary.main' : 'text.secondary'
                }}
              >
                {/* Determine which receipt icon to show */}
                {message.readBy?.length > 0 ? (
                  <DoneAllIcon fontSize="small" sx={{ fontSize: 14, color: 'primary.main' }} />
                ) : (
                  <DoneIcon fontSize="small" sx={{ fontSize: 14, opacity: 0.7 }} />
                )}
              </Box>
            )}
            
            <Typography 
              variant="caption" 
              sx={{ opacity: 0.8 }}
            >
              {formatMessageTime(message.createdAt)}
            </Typography>
            
            {isSentByCurrentUser && (
              <IconButton 
                size="small" 
                onClick={handleMenuOpen}
                sx={{ opacity: 0.8, p: 0.2 }}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        </Paper>
      </Box>
      
      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem 
          onClick={handleDeleteMessage}
          disabled={deleting}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default MessageItem;
