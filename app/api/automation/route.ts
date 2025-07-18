import { NextRequest, NextResponse } from "next/server";
import { FormData } from "../../script/automationScript";
import { startAutomation } from "../../utils/automation";
import { getUserIdFromRequest } from "../../utils/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const formData: FormData = await request.json();
    const userId = await getUserIdFromRequest(request);
    
    // Use the shared automation function
    const result = await startAutomation(formData, request.nextUrl.origin, userId);
    
    if (result.success) {
      return NextResponse.json(result);
    } else {
      return NextResponse.json(result, { status: 500 });
    }

  } catch (error) {
    console.error("Error in automation API route:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: "Failed to start automation",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
