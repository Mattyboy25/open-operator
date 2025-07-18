import { NextRequest } from "next/server";
import { getUserIdFromRequest } from "../../../utils/auth";

export const runtime = "nodejs";

// Store active event streams with user context
const eventStreams = new Map<string, { controller: ReadableStreamDefaultController; userId?: string }>();

export function GET(request: NextRequest) {
  const url = new URL(request.url);
  const executionId = url.searchParams.get('executionId');
  
  if (!executionId) {
    return new Response('Missing executionId parameter', { status: 400 });
  }

  console.log(`Creating SSE connection for execution: ${executionId}`);

  const stream = new ReadableStream({
    async start(controller) {
      console.log(`SSE stream started for execution: ${executionId}`);
      
      // Get user ID from request for authentication context
      const userId = await getUserIdFromRequest(request);
      console.log(`User ID for execution ${executionId}: ${userId}`);
      
      // Store the controller with user context so we can send events to it
      eventStreams.set(executionId, { controller, userId });
      
      // Send initial connection event
      const data = `data: ${JSON.stringify({
        type: 'connected',
        message: 'Connected to automation events'
      })}\n\n`;
      controller.enqueue(new TextEncoder().encode(data));
    },
    cancel() {
      console.log(`SSE stream cancelled for execution: ${executionId}`);
      eventStreams.delete(executionId);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    },
  });
}

// Function to send events to a specific execution
export function sendEventToExecution(executionId: string, event: string, data: unknown) {
  console.log(`sendEventToExecution called - ExecutionId: ${executionId}, Event: ${event}, Data:`, data);
  console.log(`Available streams:`, Array.from(eventStreams.keys()));
  
  // Get the stream context (controller + userId)
  const streamContext = eventStreams.get(executionId);
  
  // Handle job completion events
  if (event === 'finished') {
    // Import and notify job queue that automation completed
    import('../../../utils/jobQueue').then(({ jobQueue }) => {
      jobQueue.markJobCompleted(executionId);
    }).catch(console.error);
  } else if (event === 'error') {
    // Import and notify job queue that automation failed
    import('../../../utils/jobQueue').then(({ jobQueue }) => {
      jobQueue.markJobFailed(executionId, typeof data === 'string' ? data : JSON.stringify(data));
    }).catch(console.error);
  }
  
  const controller = streamContext?.controller;
  if (controller) {
    try {
      const eventData = `data: ${JSON.stringify({
        type: event,
        message: typeof data === 'string' ? data : JSON.stringify(data),
        data: data
      })}\n\n`;
      console.log(`Sending event data:`, eventData);
      controller.enqueue(new TextEncoder().encode(eventData));
      console.log(`Successfully sent event '${event}' to execution ${executionId}`);
    } catch (error) {
      console.error(`Failed to send event to execution ${executionId}:`, error);
      eventStreams.delete(executionId);
    }
  } else {
    console.warn(`No active stream found for execution: ${executionId}`);
    console.log(`Available streams:`, Array.from(eventStreams.keys()));
  }
}
