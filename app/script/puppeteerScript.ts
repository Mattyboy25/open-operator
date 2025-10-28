import puppeteer, { Browser, Page } from "puppeteer-core";
import Browserbase from "@browserbasehq/sdk";

// Type definitions for the form data
export interface FormData {
  companyCode: string;
  username: string;
  password: string;
  caseNumber: string;
  dateOfService: string;
  startTime: string;
  endTime: string;
  serviceTypeIdentifier: string;
  personServed: string;
  mileageStartAddress?: string;
  mileageStartMileage?: string;
  observationNotes56a?: ObservationNotes;
  endAddresses: string[];
  additionalDropdownValues: string[];
  noteSummary47e?: string;
}

export interface ObservationNotes {
  pickUpAddress?: string;
  locationAddress?: string;
  purposeOfTransportation?: string;
  delaysDescription?: string;
  interactionsWithParentGuardian?: string;
  interactionsWithClient?: string;
  clientDressedAppropriately?: string;
  concerns?: string;
}

interface ObservationNotesEntry {
  field: string;
  value: string;
}

interface ProcessedNoteData {
  dateOfService: string;
  startTime: string;
  endTime: string;
  mileage: number;
}

// Event emitter interface for progress updates
export interface ProgressEmitter {
  emit: (uid: string, event: string, data: unknown) => void;
}

// Helper function to close Browserbase session
async function closeBrowserbaseSession(sessionId: string): Promise<void> {
  try {
    console.log(`Attempting to close Browserbase session: ${sessionId}`);
    const response = await fetch('/api/session', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId }),
    });
    
    if (response.ok) {
      console.log(`Successfully closed Browserbase session: ${sessionId}`);
    } else {
      console.warn(`Failed to close Browserbase session: ${sessionId}`, await response.text());
    }
  } catch (error) {
    console.error(`Error closing Browserbase session: ${sessionId}`, error);
  }
}

// Helper function to close only the Browserbase session (not the browser)
async function closeSessionOnly(sessionId: string): Promise<void> {
  console.log("Closing Browserbase session only (keeping browser alive)");
  await closeBrowserbaseSession(sessionId);
}

export async function runPuppeteerScript(
  formData: FormData, 
  uid: string,
  sessionId: string,
  emitToUser?: (uid: string, event: string, data: unknown) => void
): Promise<void> {
  const {
    companyCode,
    username,
    password,
    caseNumber,
    dateOfService,
    startTime,
    endTime,
    serviceTypeIdentifier,
    personServed,
    mileageStartAddress,
    mileageStartMileage,
    observationNotes56a,
    endAddresses,
    additionalDropdownValues,
    noteSummary47e
  } = formData;

  // Default emitter if none provided with debugging
  const emit = emitToUser || (() => {});
  
  // Debug emitter function availability
  console.log(`[EMIT DEBUG] emitToUser function type: ${typeof emitToUser}`);
  console.log(`[EMIT DEBUG] emitToUser is null/undefined: ${emitToUser == null}`);
  console.log(`[EMIT DEBUG] final emit function type: ${typeof emit}`);
  
  // Enhanced emit wrapper with logging and error handling
  const safeEmit = (uid: string, event: string, data: unknown) => {
    try {
      console.log(`[EMIT] uid: ${uid}, event: ${event}, data:`, data);
      
      if (!emitToUser) {
        console.error(`[EMIT CRITICAL] emitToUser function is null/undefined!`);
        return;
      }
      
      if (typeof emitToUser !== 'function') {
        console.error(`[EMIT CRITICAL] emitToUser is not a function, type: ${typeof emitToUser}`);
        return;
      }
      
      emitToUser(uid, event, data);
      console.log(`[EMIT SUCCESS] Event '${event}' sent successfully`);
    } catch (error) {
      console.error(`[EMIT ERROR] Failed to emit event '${event}':`, error);
      console.error(`[EMIT ERROR] Error stack:`, error instanceof Error ? error.stack : 'No stack available');
    }
  };

  // Test emit connection immediately
  console.log(`[SCRIPT START] Starting automation for uid: ${uid}`);
  safeEmit(uid, 'script_started', { 
    timestamp: new Date().toISOString(), 
    sessionId: sessionId,
    formDataKeys: Object.keys(formData)
  });

  // Function to test connection at critical points
  const testConnection = (context: string) => {
    console.log(`[CONNECTION TEST] Testing at: ${context}`);
    safeEmit(uid, 'connection_checkpoint', {
      context,
      timestamp: new Date().toISOString(),
      uid: uid
    });
  };

  // Enhanced error message formatter for better user experience
  const formatUserError = (error: Error | string, context: string): string => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Session closed or protocol errors
    if (errorMessage.includes('Session closed') || 
        errorMessage.includes('Protocol error') ||
        errorMessage.includes('Page is no longer valid') ||
        errorMessage.includes('TargetCloseError')) {
      return `🔄 Browser session expired while ${context}. This can happen due to:
      
• Session timeout (sessions last ~10 minutes)
• Network connectivity issues  
• Page navigation or refresh

💡 Please try again - a fresh session will be created automatically.`;
    }

    // Selector not found errors
    if (errorMessage.includes('Selector') && errorMessage.includes('not found')) {
      return `🎯 Unable to find expected form element while ${context}. This may indicate:
      
• The website layout has changed
• The page hasn't fully loaded
• Network delay affecting page content

💡 Please try again in a moment, or contact support if the issue persists.`;
    }

    // Timeout errors
    if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      return `⏱️ Operation timed out while ${context}. This could be due to:
      
• Slow website response
• Heavy server load
• Network connectivity issues

💡 Please try again - the system will retry automatically.`;
    }

    // Connection errors
    if (errorMessage.includes('connect') || errorMessage.includes('Connection')) {
      return `🌐 Connection issue while ${context}. Please check:
      
• Your internet connection
• Website availability
• Try again in a few moments

💡 If the problem persists, the target website may be experiencing issues.`;
    }

    // Generic error with context
    return `❌ Error while ${context}: ${errorMessage}

💡 Please try again, or contact support if this error continues to occur.`;
  };

  // Remove the local chromium path requirement since we're using Browserbase
  // const { stdout: chromiumPath } = await promisify(exec)("which chromium");

  const desiredOrder: (keyof ObservationNotes)[] = [
    'pickUpAddress',
    'locationAddress',
    'purposeOfTransportation',
    'delaysDescription',
    'interactionsWithParentGuardian',
    'interactionsWithClient',
    'clientDressedAppropriately',
    'concerns'
  ];

  // Reorder keys in the observation notes object
  const reorderObjectKeys = (obj: ObservationNotes = {}, order: (keyof ObservationNotes)[]): ObservationNotes => {
    const ordered: ObservationNotes = {};
    order.forEach(key => {
      ordered[key] = obj.hasOwnProperty(key) ? obj[key] : '';
    });
    return ordered;
  };

  const defaultTimeout = 15000; // Reduced from 30s to 15s
  const shortTimeout = 4000; // For quick operations
  const mediumTimeout = 10000; // For medium operations
  const orderedObservationNotes56a = reorderObjectKeys(observationNotes56a, desiredOrder);
  const observationNotesArray: ObservationNotesEntry[] = Object.entries(orderedObservationNotes56a).map(
    ([field, value]) => ({ field, value: value || '' })
  );

  // Simple sleep function
  const sleep = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  // Page state validation function
  const isPageValid = async (page: Page): Promise<boolean> => {
    try {
      // Check if page is closed
      if (page.isClosed()) {
        console.log("Page is closed");
        return false;
      }
      
      // Try to get page URL - this will throw if session is closed
      await page.url();
      
      // Try to evaluate a simple expression
      await page.evaluate(() => document.readyState);
      
      return true;
    } catch (error) {
      console.log("Page validation failed:", error);
      return false;
    }
  };

  // Enhanced selector waiting with page validation and retry logic
  const waitForSelectorWithValidation = async (
    page: Page, 
    selector: string, 
    options: { visible?: boolean; timeout?: number; retries?: number } = {}
  ): Promise<void> => {
    const { visible = true, timeout = defaultTimeout, retries = 2 } = options;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // First validate the page is still active
        if (!(await isPageValid(page))) {
          throw new Error("Page is no longer valid - session may have been closed");
        }
        
        await page.waitForSelector(selector, { visible, timeout });
        return; // Success
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isSessionError = errorMessage.includes('Session closed') || 
                               errorMessage.includes('Protocol error') ||
                               errorMessage.includes('Page is no longer valid');
        
        if (isSessionError) {
          // For session errors, don't retry - fail fast
          throw new Error(`Session was closed while waiting for selector "${selector}". Please try again.`);
        }
        
        // For other errors, retry if attempts remain
        if (attempt < retries) {
          console.log(`Attempt ${attempt + 1} failed for selector "${selector}", retrying... Error: ${errorMessage}`);
          await sleep(1000); // Wait 1 second before retry
          continue;
        }
        
        // Final attempt failed
        throw error;
      }
    }
  };

  // Retry wrapper for critical operations
  const retryOperation = async <T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 2
  ): Promise<T> => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isSessionError = errorMessage.includes('Session closed') || 
                               errorMessage.includes('Protocol error') ||
                               errorMessage.includes('Page is no longer valid');
        
        if (isSessionError || attempt === maxRetries) {
          throw error; // Don't retry session errors or if max retries reached
        }
        
        console.log(`${operationName} attempt ${attempt + 1} failed, retrying... Error: ${errorMessage}`);
        await sleep(2000); // Wait 2 seconds before retry
      }
    }
    throw new Error(`${operationName} failed after ${maxRetries + 1} attempts`);
  };

  // Human-like typing function for sensitive inputs with page validation
  const humanLikeType = async (page: Page, selector: string, text: string): Promise<void> => {
    // Validate page before attempting operations
    if (!(await isPageValid(page))) {
      throw new Error(`Page is no longer valid - cannot type in selector "${selector}"`);
    }

    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Selector "${selector}" not found.`);
    }
    
    await element.focus();
    
    // Clear existing content
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await sleep(30);
    await page.keyboard.press('Backspace');
    
    // Type each character with human-like timing
    for (let i = 0; i < text.length; i++) {
      // Validate page periodically during long typing operations
      if (i % 10 === 0 && !(await isPageValid(page))) {
        throw new Error(`Page became invalid during typing operation at character ${i}`);
      }

      const char = text[i];
      await page.keyboard.type(char, { delay: 0 });
      
      // Vary typing speed: 
      // - Faster for common characters
      // - Slower for numbers/special characters
      // - Occasional longer pauses to simulate thinking
      let delay;
      if (/[a-z]/i.test(char)) {
        delay = Math.floor(Math.random() * 50) + 25; // 25-75ms for letters
      } else if (/[0-9]/.test(char)) {
        delay = Math.floor(Math.random() * 80) + 40; // 40-120ms for numbers
      } else {
        delay = Math.floor(Math.random() * 100) + 60; // 60-160ms for special chars
      }
      
      // Occasional longer pauses (simulate thinking/checking)
      if (Math.random() < 0.1) {
        delay += Math.floor(Math.random() * 200) + 100; // Add 100-300ms occasionally
      }
      
      await sleep(delay);
    }
    
    // Trigger events
    await page.evaluate((selector) => {
      const element = document.querySelector(selector) as HTMLInputElement;
      if (element) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
      }
    }, selector);
  };

  // Optimized selector validation - checks multiple selectors in parallel
  const waitForAnySelector = async (page: Page, selectors: string[], timeout: number = shortTimeout): Promise<string | null> => {
    try {
      const promises = selectors.map(selector => 
        page.waitForSelector(selector, { visible: true, timeout }).then(() => selector).catch(() => null)
      );
      const results = await Promise.allSettled(promises);
      const found = results.find(result => result.status === 'fulfilled' && result.value);
      return found?.status === 'fulfilled' ? found.value : null;
    } catch {
      return null;
    }
  };

  // Format date to MM/DD/YY format
  const formatDateOutput = (dateStr: string): string => {
    if (typeof dateStr !== 'string') {
      throw new Error(`Invalid date format: expected a string, received ${typeof dateStr}`);
    }
    dateStr = dateStr.trim();
    console.log(`Received dateStr: "${dateStr}"`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-');
      const formattedDate = `${month}/${day}/${year.slice(-2)}`;
      console.log(`Formatted date from YYYY-MM-DD to MM/DD/YY: "${formattedDate}"`);
      return formattedDate;
    }
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      let [month, day] = parts;
      const year = parts[2];
      if (
        isNaN(Number(month)) || isNaN(Number(day)) || isNaN(Number(year)) ||
        Number(month) < 1 || Number(month) > 12 ||
        Number(day) < 1 || Number(day) > 31 ||
        year.length !== 4
      ) {
        throw new Error(`Invalid date components in "${dateStr}"`);
      }
      month = month.padStart(2, '0');
      day = day.padStart(2, '0');
      const shortYear = year.slice(-2);
      const formattedDate = `${month}/${day}/${shortYear}`;
      console.log(`Formatted date from MM/DD/YYYY to MM/DD/YY: "${formattedDate}"`);
      return formattedDate;
    }
    throw new Error(`Invalid date format: expected "MM/DD/YYYY" or "YYYY-MM-DD", check the Date of Service`);
  };

  const formattedDate = formatDateOutput(dateOfService);

  // Format time to "h:mm AM/PM" format
  const formatTime = (timeStr: string): string => {
    console.log(`Converting time: "${timeStr}"`);
    // Handle both 24-hour format (HH:MM) and existing formats with AM/PM
    const time24Match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (time24Match) {
      // Convert 24-hour format to 12-hour format with AM/PM
      const [, hours, minutes] = time24Match;
      const hour24 = parseInt(hours, 10);
      const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
      const period = hour24 >= 12 ? 'PM' : 'AM';
      const converted = `${hour12}:${minutes} ${period}`;
      console.log(`Converted 24-hour time "${timeStr}" to "${converted}"`);
      return converted;
    }
    
    // Handle existing format with AM/PM
    const match = timeStr.match(/(\d{1,2})(:?)(\d{0,2})\s*(AM|PM)?/i);
    if (!match) {
      throw new Error(`Invalid time format: ${timeStr}`);
    }
    const [, hours, , minutes = "00", period] = match;
    const hoursNum = parseInt(hours, 10);
    const finalPeriod = period ? period.toUpperCase() : (hoursNum >= 5 && hoursNum <= 11 ? "AM" : "PM");
    const result = `${hoursNum}:${minutes.padStart(2, '0')} ${finalPeriod}`;
    console.log(`Formatted time "${timeStr}" to "${result}"`);
    return result;
  };

  const formattedStartTime = formatTime(startTime);
  const formattedEndTime = formatTime(endTime);
  console.log(`Final formatted times - Start: "${formattedStartTime}", End: "${formattedEndTime}"`);
  const targetServiceTime = `${formattedStartTime} to ${formattedEndTime}`;

  // Selector templates for mileage fields
  const mileageEndAddressSelectorTemplate = (index: number): string =>
    `#DataModels_${index}__EndAddress`;

  const additionalDropdownSelectorTemplate = (index: number): string =>
    `#DataModels_${index}__PurposeOfTripId`;

  // Function to populate the start address and mileage
  const populateStartDetails = async (
    page: Page, 
    address: string, 
    mileage: string, 
    mileageStartAddressSelector: string, 
    mileageStartMileageSelector: string
  ): Promise<void> => {
    try {
      await sleep(200); // Reduced from 1000ms
      await page.click('#addButton');

      await waitForSelectorWithValidation(page, mileageStartAddressSelector, { visible: true, timeout: defaultTimeout });
      await clearAndType(page, mileageStartAddressSelector, address);
      console.log(`Entered Start Address: "${address}"`);
      await waitForSelectorWithValidation(page, mileageStartMileageSelector, { visible: true, timeout: defaultTimeout });
      await humanLikeType(page, mileageStartMileageSelector, mileage);
      console.log(`Entered Start Mileage: "${mileage}"`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error populating Start Address and Start Mileage:", error);
      
      // Only close session for actual session-related errors
      if (errorMessage.includes('Session closed') || 
          errorMessage.includes('Protocol error') || 
          errorMessage.includes('Target closed') ||
          errorMessage.includes('TargetCloseError') ||
          errorMessage.includes('Page is no longer valid') ||
          errorMessage.includes('page session was closed')) {
        const userFriendlyError = formatUserError(errorMessage, 'populating start address and mileage');
        safeEmit(uid, 'error', userFriendlyError);
        isBrowserClosed = true;
        await closeSessionOnly(sessionId);
        throw new Error('Browser session closed while populating start details. Please retry the operation.');
      } else {
        const userFriendlyError = formatUserError(errorMessage, 'populating start address and mileage');
        safeEmit(uid, 'error', userFriendlyError);
        throw error;
      }
    }
  };

  const getLastEndMileageValue = async (page: Page): Promise<string | null> => {
    try {
      // Validate page state before operation
      if (!(await isPageValid(page))) {
        console.warn("Page is no longer valid when trying to get end mileage value");
        return null;
      }

      // Try multiple selector patterns for End Mileage fields
      const endMileageSelectors = [
        "#data-models-table-body input[id*='__EndMileage']",
        "input[id*='EndMileage']",
        "#data-models-table-body input[name*='EndMileage']",
        "input[name*='EndMileage']"
      ];
      
      let endMileageElements: any[] = [];
      let usedSelector = "";
      
      for (const selector of endMileageSelectors) {
        try {
          await waitForSelectorWithValidation(page, selector, { visible: true, timeout: 3000 });
          endMileageElements = await page.$$(selector);
          if (endMileageElements.length > 0) {
            usedSelector = selector;
            console.log(`Found ${endMileageElements.length} End Mileage input fields using selector: ${selector}`);
            break;
          }
        } catch (error) {
          console.log(`Selector "${selector}" not found, trying next...`);
          continue;
        }
      }
      
      if (endMileageElements.length === 0) {
        console.warn("No 'End Mileage' input fields found with any selector pattern.");
        return null;
      }
      
      const lastEndMileageElement = endMileageElements[endMileageElements.length - 1];
      
      // Use retry operation for the page.evaluate call
      const endMileageValue = await retryOperation(async () => {
        if (!(await isPageValid(page))) {
          throw new Error("Page session closed during mileage value retrieval");
        }
        
        // Get all values for debugging
        const allValues = await page.evaluate(elements => {
          return elements.map((el, index) => ({
            index,
            id: (el as HTMLInputElement).id,
            value: (el as HTMLInputElement).value,
            placeholder: (el as HTMLInputElement).placeholder || '',
            type: (el as HTMLInputElement).type
          }));
        }, endMileageElements);
        
        console.log("All End Mileage field values:", JSON.stringify(allValues, null, 2));
        
        const value = await page.evaluate(el => (el as HTMLInputElement).value, lastEndMileageElement);
        console.log(`Retrieved End Mileage value from last field (index ${endMileageElements.length - 1}): "${value}"`);
        return value;
      }, "Getting last end mileage value", 1);
      
      // Return the value even if it's empty - let the caller decide what to do
      return endMileageValue || null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Session closed') || 
          errorMessage.includes('Protocol error') || 
          errorMessage.includes('Target closed') ||
          errorMessage.includes('Page is no longer valid')) {
        console.warn("Session was closed while retrieving end mileage value");
        return null; // Return null instead of throwing to allow graceful continuation
      }
      console.error("Error retrieving the last 'End Mileage' value:", error);
      return null;
    }
  };

  // Optimized clearAndType function with human-like typing for number inputs
  const clearAndType = async (page: Page, selector: string, text: string): Promise<void> => {
    try {
      // Validate page before attempting operations
      if (!(await isPageValid(page))) {
        throw new Error(`Page is no longer valid - cannot interact with selector "${selector}"`);
      }

      await waitForSelectorWithValidation(page, selector, { visible: true, timeout: shortTimeout });
      
      // Check if it's a number input field
      const elementType = await page.evaluate((selector) => {
        const el = document.querySelector(selector) as HTMLInputElement;
        return el ? el.type : null;
      }, selector);
      
      // For number inputs, use human-like typing to avoid detection
      if (elementType === 'number') {
        console.log(`Detected number input for "${selector}", using human-like typing`);
        const element = await page.$(selector);
        if (!element) {
          throw new Error(`Selector "${selector}" not found.`);
        }
        
        await element.focus();
        
        // Clear existing content with human-like selection
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await sleep(10); // Small pause like a human
        await page.keyboard.press('Backspace');
        
        // Type each character with human-like variations in timing
        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          await page.keyboard.type(char, { delay: 0 });
          // Random delays between 30-120ms to simulate human typing
          const randomDelay = Math.floor(Math.random() * 90) + 30;
          await sleep(randomDelay);
        }
        
        // Trigger events to ensure proper form handling
        await page.evaluate((selector) => {
          const element = document.querySelector(selector) as HTMLInputElement;
          if (element) {
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.blur();
          }
        }, selector);
        
        console.log(`Human-like typed number into "${selector}": "${text}"`);
        return;
      }
      
      // For non-number inputs, use the fastest method: direct value setting
      const success = await page.evaluate((selector, text) => {
        const element = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
        if (element) {
          element.focus();
          element.value = text;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          element.blur();
          return true;
        }
        return false;
      }, selector, text);
      
      if (success) {
        console.log(`Fast input for "${selector}": "${text}"`);
        return;
      }
    } catch (error) {
      console.warn(`Fast method failed for "${selector}", using fallback`);
    }
    
    // Fallback to keyboard method only if needed
    try {
      const element = await page.$(selector);
      if (!element) {
        throw new Error(`Selector "${selector}" not found.`);
      }
      
      await element.focus();
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await element.type(text, { delay: 1 }); // Very fast typing for fallback
      console.log(`Fallback typed into "${selector}": "${text}"`);
    } catch (fallbackError) {
      safeEmit(uid, 'error', `Error in clearAndType for selector: ${fallbackError}`);
      console.error(`Error in clearAndType for selector "${selector}":`, fallbackError);
      throw fallbackError;
    }
  };

  const sanitizeTime = (timeStr: string): string => {
    return timeStr.replace(/\s+/g, '');
  };

  const processMileageTable = async (page: Page): Promise<void> => {
    const tableSelector = '#searchResultsTable';
    const noTripsMessageSelector = '.alert.alert-subtle-info.p-2';
    safeEmit(uid, 'progress', 'Processing Mileage Table...');

    try {
      await sleep(2000); // Reduced from 4500ms

      // Debug: Check what elements are actually present on the page
      const pageContent = await page.evaluate(() => {
        const elements = {
          searchResultsTable: !!document.querySelector('#searchResultsTable'),
          alertInfo: !!document.querySelector('.alert.alert-subtle-info.p-2'),
          allAlerts: Array.from(document.querySelectorAll('.alert')).map(el => ({
            className: el.className,
            text: el.textContent?.trim().substring(0, 100) || '',
            visible: (el as HTMLElement).offsetParent !== null
          })),
          allTables: Array.from(document.querySelectorAll('table')).map(el => el.id || el.className),
          bodyText: document.body.innerText.substring(0, 500)
        };
        return elements;
      });
      

      // First, check if any alerts contain "no trips" message
      const noTripsAlert = await page.evaluate(() => {
        const alerts = document.querySelectorAll('.alert');
        for (const alert of alerts) {
          const text = alert.textContent?.toLowerCase() || '';
          if (text.includes('no trips') || text.includes('no data') || text.includes('empty')) {
            return {
              found: true,
              text: alert.textContent?.trim() || '',
              className: alert.className
            };
          }
        }
        return { found: false };
      });

      if (noTripsAlert.found) {
        console.log(`Found "no trips" message: "${noTripsAlert.text}"`);
        return;
      }

      // If no "no trips" message, try to wait for table or specific alert
      const raceResult = await Promise.race([
        page.waitForSelector(tableSelector, { visible: true, timeout: 8000 }).then(() => 'table'),
        page.waitForSelector(noTripsMessageSelector, { visible: true, timeout: 8000 }).then(() => 'message'),
        new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 8000))
      ]);

      if (raceResult === 'table') {
        console.log('Mileage table found.');
        const rowSelector = '#data-models-table-body tr';

        while (true) {
          const rows = await page.$$(rowSelector);
          if (rows.length === 0) {
            console.log('No mileage entries found. Exiting deletion loop.');
            break;
          }
          console.log(`Processing deletion for ${rows.length} remaining row(s).`);
          const row = rows[0];

          const dropdownToggle = await row.$('td.min a.dropdown');
          if (!dropdownToggle) {
            console.warn('Dropdown toggle not found in the first row. Skipping deletion.');
            break;
          }
          await dropdownToggle.click();

          const deleteButtonSelector = '.dropdown-item.confirm-delete';
          const deleteButton = await row.waitForSelector(deleteButtonSelector, { visible: true, timeout: defaultTimeout });
          if (!deleteButton) {
            console.warn('Delete button not found in the first row.');
            break;
          }
          await deleteButton.click();
          console.log('Clicked delete for the first row.');

          await page.waitForSelector('#confirmationOkButton', { visible: true, timeout: defaultTimeout });
          await sleep(700); // Reduced from 1500ms
          await page.click('#confirmationOkButton');

          await page.waitForFunction(() => {
            const toastContainer = document.getElementById("toast-container");
            if (!toastContainer) return false;
            const toastMessage = toastContainer.querySelector(".toast-message");
            return toastMessage && toastMessage.textContent?.includes("Changes saved successfully.");
          }, { timeout: defaultTimeout });
          console.log('Deletion confirmed via toast message.');
          await sleep(700); // Reduced from 1500ms
        }
      } else if (raceResult === 'message') {
        console.log('"No trips found" message found. Proceeding to add new mileage.');
        return;
      } else {
        // Timeout occurred, try alternative approaches
        safeEmit(uid, 'progress', 'Timeout occurred, checking for alternative elements...');
        
        // Check for alternative "no trips" message patterns
        const alternativeNoTripsSelectors = [
          '.alert-info',
          '.alert.alert-info',
          '.alert-warning',
          '.alert.alert-warning',
          '[class*="alert"][class*="info"]',
          '[class*="no-trips"]',
          '[class*="empty"]'
        ];
        
        let foundAlternative = false;
        for (const selector of alternativeNoTripsSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              const text = await page.evaluate(el => el.textContent?.toLowerCase() || '', element);
              if (text.includes('no trips') || text.includes('no data') || text.includes('empty')) {
                console.log(`Found alternative "no trips" message with selector: ${selector}`);
                foundAlternative = true;
                return;
              }
            }
          } catch (e) {
         
          }
        }
        
        if (!foundAlternative) {
          console.error('Neither mileage table nor "No trips found" message found within the timeout.');
          console.error('Page debug info:', pageContent);
          throw new Error('Mileage table or "No trips found" message not found within the timeout.');
        }
      }
    } catch (error) {
      console.error('An error occurred:', (error as Error).message);
      throw error;
    }
  };

  // Helper function to handle optional continue button without affecting main flow
  const handleOptionalContinueButton = async (page: Page): Promise<void> => {
    const mileageContinueSelector = "#getMileageContinueButton";
    try {
      // Use regular waitForSelector for optional elements to avoid session validation issues
      await page.waitForSelector(mileageContinueSelector, { visible: true, timeout: 2000 });
      await page.click(mileageContinueSelector);
      console.log("Clicked 'Continue' on mileage confirmation modal");
    } catch (error) {
      // This is expected behavior - the button may not appear, just continue
      console.log("Continue button did not appear within 2 seconds, proceeding without clicking");
    }
  };

  // Helper function to handle optional toast message without affecting main flow
  const handleOptionalToastMessage = async (page: Page): Promise<void> => {
    await sleep(800); // Allow time for toast to appear
    try {
      await page.waitForFunction(() => {
        const toastContainer = document.getElementById("toast-container");
        if (!toastContainer) return false;
        const toastMessage = toastContainer.querySelector(".toast-message");
        return toastMessage && toastMessage.textContent?.includes("Changes saved successfully.");
      }, { timeout: defaultTimeout });
      console.log("Mileage saved successfully (toast message appeared).");
    } catch (error) {
      console.log("Timeout waiting for mileage save confirmation toast message - continuing anyway.");
      // Don't treat this as a critical error that should close the session
    }
    await sleep(50); // Small pause after toast handling
  };

  const populateMileageEntries = async (page: Page, endAddresses: string[], additionalDropdownValues: string[]): Promise<void> => {
    for (let i = 0; i < endAddresses.length; i++) {
      const endAddress = endAddresses[i];
      const additionalValue = additionalDropdownValues[i];
      const mileageEndAddressSelector = mileageEndAddressSelectorTemplate(i);
      const additionalDropdownSelector = additionalDropdownSelectorTemplate(i);

      try {
        if (i > 0) {
          const newMileageButtonSelector = "#addButton";
          await waitForSelectorWithValidation(page, newMileageButtonSelector, { visible: true, timeout: defaultTimeout });
          await page.click(newMileageButtonSelector);
          console.log(`Clicked on "New" button to add mileage entry ${i}`);
          await sleep(1200);
        }

        await waitForSelectorWithValidation(page, mileageEndAddressSelector, { visible: true, timeout: defaultTimeout });
        console.log(`End Address input is present in the DOM for entry (${i}).`);
        await clearAndType(page, mileageEndAddressSelector, endAddress);
        await sleep(200); // Reduced from 1000ms
        console.log(`Entered End Address (${i}): "${endAddress}"`);
        await sleep(300); // Reduced from 1000ms

        // Validate page state before dropdown operations
        if (!(await isPageValid(page))) {
          throw new Error(`Page session was closed before processing dropdown for entry ${i}`);
        }

        const availableOptions = await retryOperation(async () => {
          if (!(await isPageValid(page))) {
            throw new Error(`Page session closed during dropdown options retrieval`);
          }
          return await page.evaluate((selector) => {
            const select = document.querySelector(selector) as HTMLSelectElement;
            if (!select) throw new Error(`Selector "${selector}" not found.`);
            return Array.from(select.options).map(option => option.textContent?.trim() || '');
          }, additionalDropdownSelector);
        }, `Getting dropdown options for entry ${i}`, 1);
        
        console.log(`Available options for Purpose of Trip (${i}):`, availableOptions);

        // Enhanced dropdown selection with verification and retry logic
        let additionalDropdownSelected = false;
        let selectionAttempts = 0;
        const maxSelectionAttempts = 3;
        
        while (!additionalDropdownSelected && selectionAttempts < maxSelectionAttempts) {
          selectionAttempts++;
          console.log(`Dropdown selection attempt ${selectionAttempts}/${maxSelectionAttempts} for "${additionalValue}"`);
          
          additionalDropdownSelected = await retryOperation(async () => {
            if (!(await isPageValid(page))) {
              throw new Error(`Page session closed during dropdown selection`);
            }
            
            return await page.evaluate((selector, value, attemptNum) => {
              const select = document.querySelector(selector) as HTMLSelectElement;
              if (!select) throw new Error(`Selector "${selector}" not found.`);
              
              console.log(`Attempt ${attemptNum}: Looking for dropdown option matching "${value}"`);
              
              const normalizedValue = value.trim().toLowerCase();
              const matchingOption = Array.from(select.options).find(option =>
                option.textContent?.trim().toLowerCase().includes(normalizedValue)
              );
              
              if (!matchingOption) {
                console.warn(`No matching option found for additional dropdown value: "${value}"`);
                return false;
              }
              
              // Store the original scroll position
              const originalScrollTop = select.scrollTop;
              console.log(`Original scroll position: ${originalScrollTop}`);
              
              // Set the value
              select.value = matchingOption.value;
              console.log(`Set dropdown value to: ${matchingOption.value} (${matchingOption.textContent?.trim()})`);
              
              // Focus the element first to ensure it's active
              select.focus();
              
              // Trigger multiple events to ensure proper handling
              select.dispatchEvent(new Event('focus', { bubbles: true }));
              select.dispatchEvent(new Event('input', { bubbles: true }));
              select.dispatchEvent(new Event('change', { bubbles: true }));
              
              // Try to maintain scroll position
              select.scrollTop = originalScrollTop;
              
              // Verify the selection stuck
              const currentValue = select.value;
              const selectionSucceeded = currentValue === matchingOption.value;
              console.log(`Selection verification - Expected: ${matchingOption.value}, Actual: ${currentValue}, Success: ${selectionSucceeded}`);
              
              return selectionSucceeded;
            }, additionalDropdownSelector, additionalValue, selectionAttempts);
          }, `Selecting dropdown value for entry ${i} (attempt ${selectionAttempts})`, 1);
          
          if (!additionalDropdownSelected) {
            console.log(`Dropdown selection attempt ${selectionAttempts} failed, waiting before retry...`);
            await sleep(1500); // Wait longer between attempts
          }
        }
        
        // Final verification after all attempts
        if (additionalDropdownSelected) {
          // Wait a bit and verify the selection is still there
          await sleep(500);
          const verificationResult = await page.evaluate((selector, expectedValue) => {
            const select = document.querySelector(selector) as HTMLSelectElement;
            if (!select) return { success: false, reason: 'Selector not found' };
            
            const currentValue = select.value;
            const normalizedExpected = expectedValue.trim().toLowerCase();
            const selectedOption = Array.from(select.options).find(opt => opt.value === currentValue);
            const selectedText = selectedOption?.textContent?.trim().toLowerCase() || '';
            
            const stillSelected = selectedText.includes(normalizedExpected);
            
            return {
              success: stillSelected,
              currentValue: currentValue,
              selectedText: selectedOption?.textContent?.trim() || 'None',
              reason: stillSelected ? 'Selection verified' : 'Selection was reset'
            };
          }, additionalDropdownSelector, additionalValue);
          
          console.log(`Final verification result:`, verificationResult);
          additionalDropdownSelected = verificationResult.success;
        }
        
        await sleep(800); // Reduced from 1000ms but still allow settling time
        
        if (additionalDropdownSelected) {
          console.log(`Selected additional dropdown value: "${additionalValue}" for End Address (${i})`);
        } else {
          console.log(`Failed to select additional dropdown value: "${additionalValue}" for End Address (${i})`);
        }

        const getMapButtonSelector = `#data-models-table-body tr:nth-child(${i + 1}) button.btn.btn-subtle-primary.text-nowrap`;
        await waitForSelectorWithValidation(page, getMapButtonSelector, { visible: true, timeout: defaultTimeout });
        await page.click(getMapButtonSelector);
        console.log(`Clicked on the "Get Map" button for End Address (${i})`);
        
        // Handle optional continue button (only on first entry)
        if (i === 0) {
          await handleOptionalContinueButton(page);
        }

        // Handle optional toast message confirmation
        await handleOptionalToastMessage(page);
        
        // Wait for the mileage calculation to complete and populate the End Mileage field
        if (i === endAddresses.length - 1) {
          console.log("Waiting for mileage calculation to complete for the final entry...");
          safeEmit(uid, 'progress', 'Calculating final mileage...');
          
          // Wait for the End Mileage field to be populated with a non-empty value
          let endMileageValue = null;
          let attempts = 0;
          const maxAttempts = 15; // Up to 15 seconds total wait time
          
          while (attempts < maxAttempts && (endMileageValue === null || endMileageValue.trim() === '')) {
            await sleep(1000); // Wait 1 second between checks
            endMileageValue = await getLastEndMileageValue(page);
            attempts++;
            
            if (endMileageValue && endMileageValue.trim() !== '') {
              console.log(`End Mileage populated after ${attempts} seconds: "${endMileageValue}"`);
              break;
            } else {
              console.log(`Attempt ${attempts}/${maxAttempts}: End Mileage not yet populated, continuing to wait...`);
              if (attempts % 3 === 0) { // Update progress every 3 seconds
                safeEmit(uid, 'progress', `Waiting for mileage calculation... (${attempts}s)`);
              }
            }
          }
          
          if (endMileageValue && endMileageValue.trim() !== '') {
            const captureTimestamp = new Date().toISOString();
            console.log(`Final End Mileage value for the last entry is: "${endMileageValue}"`);
            // Send updated mileage data with date, time, mileage, and capture timestamp for Firebase storage
            safeEmit(uid, 'miles', {
              dateOfService,
              startTime,
              endTime,
              endMileage: endMileageValue,
              capturedAt: captureTimestamp
            });
          } else {
            console.warn(`End Mileage input not populated after ${maxAttempts} seconds of waiting.`);
            safeEmit(uid, 'warning', 'Mileage calculation took longer than expected. The final mileage may not be captured.');
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error populating mileage entry (${i}):`, error);
        
        // Check if it's a session closed error (now that optional operations are handled separately)
        if (errorMessage.includes('Session closed') || 
            errorMessage.includes('Protocol error') || 
            errorMessage.includes('Target closed') ||
            errorMessage.includes('TargetCloseError') ||
            errorMessage.includes('Page is no longer valid') ||
            errorMessage.includes('page session was closed')) {
          const userFriendlyError = formatUserError(errorMessage, `processing mileage entry ${i + 1} (${endAddress})`);
          safeEmit(uid, 'error', userFriendlyError);
          isBrowserClosed = true;
          await closeSessionOnly(sessionId);
          throw new Error(`Browser session closed while populating mileage entry ${i + 1}. Please retry the operation.`);
        } else {
          const userFriendlyError = formatUserError(errorMessage, `processing mileage entry ${i + 1} (${endAddress})`);
          safeEmit(uid, 'error', userFriendlyError);
          throw error;
        }
      }
    }
  };

  let isBrowserClosed = false;
  let browser: Browser;
  let keepAliveInterval: NodeJS.Timeout | null = null;

  // Connect to the existing Browserbase session instead of launching local browser
  try {
    console.log(`Connecting to Browserbase session: ${sessionId}`);
    
    // Get the session details from Browserbase
    const bb = new Browserbase({
      apiKey: process.env.BROWSERBASE_API_KEY!,
    });
    
    const session = await bb.sessions.retrieve(sessionId);
    
    if (!session.connectUrl) {
      throw new Error(`Session ${sessionId} does not have a valid connect URL`);
    }
    
    // Connect to the existing session
    browser = await puppeteer.connect({
      browserWSEndpoint: session.connectUrl,
      defaultViewport: null, // Use the session's viewport
    });
    
    console.log(`Successfully connected to Browserbase session: ${sessionId}`);

    // Set up keep-alive mechanism to prevent session timeout
    keepAliveInterval = setInterval(async () => {
      try {
        if (!isBrowserClosed && page && !(page.isClosed())) {
          // Perform a lightweight operation to keep session alive
          await page.evaluate(() => document.title);
          console.log('Keep-alive ping sent to maintain session');
        }
      } catch (error) {
        console.log('Keep-alive ping failed, session may be closed:', error);
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }
      }
    }, 30000); // Ping every 30 seconds

  } catch (error) {
    console.error(`Failed to connect to Browserbase session ${sessionId}:`, error);
    throw new Error(`Failed to connect to browser session: ${error}`);
  }

  console.log("addresses", endAddresses);
  
  // Get the existing page instead of creating a new one
  const pages = await browser.pages();
  let page: Page;
  
  if (pages.length > 0) {
    page = pages[0];
    console.log("Using existing page from browser session");
  } else {
    page = await browser.newPage();
    console.log("Created new page in browser session");
  }
  
  // Verify the page is still active with comprehensive validation
  try {
    if (!(await isPageValid(page))) {
      throw new Error("Page validation failed - session may be closed");
    }
    
    const url = await page.url();
    console.log(`Page is accessible and ready. Current URL: ${url}`);
    
    // Additional check: ensure we can interact with the DOM
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
  } catch (error) {
    console.error("Page is not accessible:", error);
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
    throw new Error(`Browser page is not accessible: ${error}`);
  }

  const checkForExistingNote = async (page: Page): Promise<boolean> => {
    try {
      safeEmit(uid, 'progress', 'Checking for existing notes...');
      
      // Create search string in format: MM/DD/YY h:mmAM to h:mmAM
      const searchString = `${formattedDate} ${formattedStartTime} to ${formattedEndTime}`;
      console.log(`Searching for existing note with: "${searchString}"`);
      
      // Click on the filter/search input
      const searchInputSelector = '.form-control.search-input.search';
      await page.waitForSelector(searchInputSelector, { visible: true, timeout: shortTimeout });
      await page.click(searchInputSelector);
      console.log('Clicked on search filter input');
      
      // Clear the input first
      await page.evaluate((selector) => {
        const input = document.querySelector(selector) as HTMLInputElement;
        if (input) {
          input.value = '';
          input.focus();
        }
      }, searchInputSelector);
      
      // Type the search string with no delay for faster input
      await page.type(searchInputSelector, searchString, { delay: 0 });
      console.log(`Typed search string: "${searchString}"`);
      
      // Trigger search events immediately
      await page.evaluate((selector) => {
        const input = document.querySelector(selector) as HTMLInputElement;
        if (input) {
          // Trigger various events that might be needed
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
          input.dispatchEvent(new Event('search', { bubbles: true }));
        }
      }, searchInputSelector);
      
      // Wait for the table to update with filtered results (much faster than before)
      await sleep(100); // Short wait for table to update
      
      // Check for note links with a timeout approach
      const checkStartTime = Date.now();
      const maxWaitTime = 2000; // Max 2 seconds to wait for results
      
      while (Date.now() - checkStartTime < maxWaitTime) {
        const noteFound = await page.evaluate(() => {
          const noteLinks = document.querySelectorAll('a[href*="/DFCS/Notes/Note?id="]');
          if (noteLinks.length > 0) {
            const firstLink = noteLinks[0] as HTMLElement;
            firstLink.click();
            return true;
          }
          return false;
        });
        
        if (noteFound) {
          console.log('Found existing note, clicked on it');
          safeEmit(uid, 'success', 'Found existing note!');
          return true;
        }
        
        // Check if table shows "no results" or is empty
        const tableEmpty = await page.evaluate(() => {
          const tableBody = document.querySelector('#data-models-table-body');
          if (!tableBody) return true;
          
          const rows = tableBody.querySelectorAll('tr');
          // Check if table is empty or shows no results message
          if (rows.length === 0) return true;
          
          // Check for "no results" or similar messages
          const noResultsMessages = [
            'no results',
            'no data',
            'no records',
            'no notes found',
            'no entries'
          ];
          
          const tableText = tableBody.textContent?.toLowerCase() || '';
          return noResultsMessages.some(msg => tableText.includes(msg));
        });
        
        if (tableEmpty) {
          console.log('Table is empty or shows no results - no existing note found');
          return false;
        }
        
        // Short pause before checking again
        await sleep(200);
      }
      
      console.log('No existing note found after timeout');
      return false;
      
    } catch (error) {
      console.error('Error checking for existing note:', error);
      return false;
    }
  };

  const findAndClickEdit = async (page: Page, targetDate: string, targetTime: string): Promise<boolean> => {
    console.log(`Searching for Date: "${targetDate}" and Time: "${targetTime}"...`);
    // Attempt to find any data rows; if none appear, click 'New Note' to proceed
    try {
      await page.waitForSelector("#data-models-table-body tr", { timeout: defaultTimeout });
    } catch {
      console.log("No data rows found, proceeding to create a new note");
      safeEmit(uid, 'progress', 'No existing entries found, will create new note');
      return false;
    }

    const found = await retryOperation(async () => {
      if (!(await isPageValid(page))) {
        throw new Error("Page session closed during note search");
      }
      
      return await page.evaluate((targetDate, targetTime) => {
        const convertDate = (dateStr: string): string => dateStr.slice(0, 6) + dateStr.slice(-2);
        const normalizedTargetDate = convertDate(targetDate.trim());

        const normalizeTime = (time: string): string => time.replace(/\s+/g, '').toUpperCase();
        const normalizedTargetTime = normalizeTime(targetTime.trim());

        const rows = Array.from(document.querySelectorAll("#data-models-table-body tr"));
        for (const row of rows) {
          const dateCell = row.querySelector("td.sort-DateOfService") as HTMLElement;
          const timeCell = row.querySelector("td.sort-TimeDisplay") as HTMLElement;
          if (dateCell && timeCell) {
            const rowDate = dateCell.textContent?.trim() || '';
            const rowTime = normalizeTime(timeCell.textContent?.trim() || '');
            if (rowDate === normalizedTargetDate && rowTime === normalizedTargetTime) {
              const clickableLink = dateCell.querySelector("span.text-nowrap a") as HTMLElement;
              if (clickableLink) {
                clickableLink.click();
                return true;
              }
            }
          }
        }
        return false;
      }, targetDate, targetTime);
    }, "Finding and clicking edit note", 1);

    if (found) {
      console.log(`Successfully clicked the date link for Date: "${targetDate}" and Time: "${targetTime}".`);
    } else {
      console.log(`Date link for Date: "${targetDate}" and Time: "${targetTime}" was not found.`);
    }
    return found;
  };

  const saveAndReadyNote = async (): Promise<void> => {
    try {
      safeEmit(uid, 'progress', 'Saving Note');
      const saveNoteSelector = "#saveButton";
      await page.waitForSelector(saveNoteSelector, { visible: true, timeout: defaultTimeout });
      await page.click(saveNoteSelector);
      console.log("Clicked on Save Note");

      const saveNoteModalSelector = "#saveNoteConfirmationModal";
      let isSaveNoteModalVisible = false;
      try {
        await page.waitForSelector(saveNoteModalSelector, { visible: true, timeout: 1000 });
        isSaveNoteModalVisible = true;
        console.log("Save Note modal is visible");
      } catch {
        console.log("Save Note modal did not appear");
      }

      if (isSaveNoteModalVisible) {
        const saveOnlyButtonSelector = "#saveNoteConfirmationModal .btn-subtle-success";
        await page.waitForSelector(saveOnlyButtonSelector, { visible: true, timeout: defaultTimeout });
        await page.click(saveOnlyButtonSelector);
        console.log("Clicked on 'Save and Ready' button");
      }

      try {
        await page.waitForFunction(() => {
          const toastContainer = document.getElementById("toast-container");
          if (!toastContainer) return false;
          const toastMessage = toastContainer.querySelector(".toast-title");
          return toastMessage && toastMessage.textContent?.includes("Success");
        }, { timeout: defaultTimeout });
        console.log("Save confirmation received: 'Saved Successfully!'");
        safeEmit(uid, 'success', 'Note Saved Successfully!');
        safeEmit(uid, 'toast', 'Note Saved Successfully!');
      } catch {
        console.log("Toast message did not appear.");
      }
    } catch (error) {
      safeEmit(uid, 'error', `An error occurred while saving and readying the note: ${error}`);
      console.error("An error occurred while saving and readying the note:", error);
      isBrowserClosed = true;
      await closeSessionOnly(sessionId);
      throw error;
    }
  };

  try {
    console.log("addresses", endAddresses);
    
    // Heartbeat to ensure frontend connection is maintained
    let heartbeatCounter = 0;
    keepAliveInterval = setInterval(async () => {
      try {
        if (!isBrowserClosed && page) {
          await page.evaluate(() => document.title); // Simple check to keep connection alive
          
          // Send periodic heartbeat to frontend
          heartbeatCounter++;
          safeEmit(uid, 'heartbeat', { 
            count: heartbeatCounter, 
            timestamp: new Date().toISOString(),
            status: 'active'
          });
        }
      } catch (error) {
        console.warn("Keep-alive check failed:", error);
        safeEmit(uid, 'heartbeat', { 
          count: heartbeatCounter, 
          timestamp: new Date().toISOString(),
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, 20000); // Reduced from 30s to 20s for better responsiveness
    
    // Test emit connection before starting main process
    testConnection('automation_start');
    safeEmit(uid, 'connection_test', 'Testing frontend connection before automation starts');
    console.log('[CONNECTION TEST] Sent connection test emit to frontend');
    
    safeEmit(uid, 'progress', 'Connecting to Ecasenotes...');
    // Use faster loading strategy
    await page.goto("https://portal.ecasenotes.com", { 
      waitUntil: "domcontentloaded", // Faster than networkidle2
      timeout: defaultTimeout 
    });

    safeEmit(uid, 'success', 'Ecasenotes reached');
    safeEmit(uid, 'progress', 'Signing In...');
    
    console.log(additionalDropdownValues);
    await waitForSelectorWithValidation(page, "#Company", { visible: true, timeout: defaultTimeout });
    console.log("Company Code input is visible.");
    await waitForSelectorWithValidation(page, "#Email", { visible: true, timeout: defaultTimeout });
    console.log("Email input is visible.");
    await waitForSelectorWithValidation(page, "#Password", { visible: true, timeout: defaultTimeout });
    console.log("Password input is visible.");
    
    await clearAndType(page, "#Company", companyCode);
    await clearAndType(page, "#Email", username);
    await clearAndType(page, "#Password", password);
    
    await page.click(".btn.btn-subtle-primary.w-100.mb-3");
    
    safeEmit(uid, 'success', 'Login successful!');
    console.log("Login successful and dashboard loaded");
    testConnection('after_login');
    safeEmit(uid, 'progress', 'Fetching Notes!');

    await waitForSelectorWithValidation(page, 'a[href="/cases"]', { visible: true, timeout: defaultTimeout });
    await page.click('a[href="/cases"]');

    console.log("Navigated to Cases & Notes");
    await sleep(100); // Reduced from 200ms
    
    await waitForSelectorWithValidation(page, '#SearchCriteria_CaseHeaderNumber', { visible: true, timeout: defaultTimeout });
    await page.type('#SearchCriteria_CaseHeaderNumber', caseNumber, { delay: 0 });

    console.log("Cases & Notes page loaded successfully");
    await page.click("#searchButton");
    console.log("Clicked the Search button");
    await sleep(500); // Reduced from 1000ms
    
    await page.waitForSelector(".sort-CaseNumber", { visible: true });
    console.log("Case results loaded");
    safeEmit(uid, 'success', 'Notes fetched successfully!');
    
    await page.evaluate((caseNumber) => {
      const caseLink = Array.from(document.querySelectorAll('.sort-CaseNumber')).find(el => el.textContent?.trim() === caseNumber) as HTMLElement;
      if (caseLink) {
        caseLink.click();
      } else {
        throw new Error('Case number not found');
      }
    }, caseNumber);
    
    console.log(`Clicked on case number ${caseNumber}`);
    
    await page.waitForSelector("#pageTabs", { visible: true });
    await page.evaluate(() => {
      const pageTabs = document.querySelector('#pageTabs');
      if (!pageTabs) {
        throw new Error('pageTabs element not found');
      }
      const caseNotesLink = pageTabs.querySelector('a[href*="/dfcs/notes"]') as HTMLElement;
      if (caseNotesLink) {
        caseNotesLink.click();
      } else {
        throw new Error('Case Notes link not found within pageTabs');
      }
    });
    
    console.log(`Clicked on "Case Notes" link for case number ${caseNumber}`);

    // Check for existing note first using the search filter
    const noteExists = await checkForExistingNote(page);
    
    if (!noteExists) {
      // If no existing note found, try the table search method as fallback
      const foundInTable = await findAndClickEdit(page, formattedDate, targetServiceTime);
      
      if (foundInTable) {
        console.log(`Found existing note in table for Date: "${formattedDate}" and Time: "${targetServiceTime}".`);
        safeEmit(uid, 'progress', 'Found existing note in table!');
      } else {
        console.log(`No existing note found. Proceeding to create a new note.`);
        safeEmit(uid, 'progress', 'Creating a new note!');
        await sleep(200);
        safeEmit(uid, 'progress', 'Creating Note!');

        // Create new note
        const addButtonSelector = ".mb-3.me-1.btn.btn-sm.btn-subtle-secondary.btn-floating";
        await page.waitForSelector(addButtonSelector, { visible: true, timeout: defaultTimeout });
        await page.click(addButtonSelector);
        console.log("Clicked on Add Note button to create a new case note");

        await page.waitForSelector("#DataModel_DateOfService", { visible: true });
        console.log("New Note modal appeared");

        await page.evaluate((formattedDate) => {
          const dateInput = document.getElementById("DataModel_DateOfService") as HTMLInputElement;
          if (dateInput) {
            dateInput.value = formattedDate;
            dateInput.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            throw new Error("Date of Service input not found");
          }
        }, dateOfService);

        console.log(`Date of Service set to ${dateOfService}`);
        
        await sleep(100);
        const sanitizedStartTime = sanitizeTime(formattedStartTime);
        const sanitizedEndTime = sanitizeTime(formattedEndTime);
        await page.type("#DataModel_StartTime", sanitizedStartTime, { delay: 0 });
        console.log(`Start Time set to "${sanitizedStartTime}"`);
        await page.type("#DataModel_EndTime", sanitizedEndTime, { delay: 0 });
        console.log(`End Time set to "${sanitizedEndTime}"`);
        
        await page.waitForFunction(() => {
          const selectElement = document.getElementById("DataModel_ServiceTypeId") as HTMLSelectElement;
          return selectElement && selectElement.options.length > 1;
        });
        
        console.log("Service type options loaded");
        await page.evaluate((serviceTypeIdentifier) => {
          const selectElement = document.getElementById("DataModel_ServiceTypeId") as HTMLSelectElement;
          const options = Array.from(selectElement.options);
          const matchingOption = options.find(option =>
            option.textContent?.toLowerCase().includes(serviceTypeIdentifier.toLowerCase())
          );
          
          if (matchingOption) {
            selectElement.value = matchingOption.value;
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            throw new Error(`Service type with identifier "${serviceTypeIdentifier}" not found`);
          }
        }, serviceTypeIdentifier);
        console.log(`Service type set to option containing identifier "${serviceTypeIdentifier}"`);

        await page.waitForFunction(() => {
          const selectElement = document.getElementById("DataModel_CaseApprovedHourChildId") as HTMLSelectElement;
          return selectElement && selectElement.options.length > 1;
        });

        await page.evaluate((personServed) => {
          const selectElement = document.getElementById("DataModel_CaseApprovedHourChildId") as HTMLSelectElement;
          const options = Array.from(selectElement.options);
          const matchingOption = options.find(option =>
            option.textContent?.toLowerCase().includes(personServed.toLowerCase())
          );
          if (matchingOption) {
            selectElement.value = matchingOption.value;
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            throw new Error(`Person served "${personServed}" not found`);
          }
        }, personServed);
        console.log(`Person served set to "${personServed}"`);

        await page.waitForSelector("#saveButton", { visible: true });
        await page.click("#saveButton");
        await sleep(500);

        safeEmit(uid, 'success', 'Note Created!');
        safeEmit(uid, 'toast', 'Note Created!');
      }
    } else {
      safeEmit(uid, 'progress', 'Found existing note! Proceeding to edit...');
    }
    
    safeEmit(uid, 'progress', 'Proceeding to edit Note!');
    safeEmit(uid, 'progress', 'Making observations!');

    console.log('original', observationNotes56a);
    console.log('formatted', observationNotesArray);
    
    if (serviceTypeIdentifier.toLowerCase() === "56a") {
      console.log('Service Type Identifier is "56a". Populating observation notes.');
      for (let i = 0; i <= observationNotesArray.length - 1; i++) {
        const { field, value } = observationNotesArray[i];
        const textareaSelector = `#NewNoteValues_${i}__0_`;
        
        try {
          await retryOperation(async () => {
            // Validate page state before each operation
            if (!(await isPageValid(page))) {
              throw new Error(`Page session was closed before populating ${field}`);
            }

            await waitForSelectorWithValidation(page, textareaSelector, { 
              visible: true, 
              timeout: defaultTimeout,
              retries: 1 // One retry for selectors
            });
            
            safeEmit(uid, 'progress', `Populating ${field} with content: "${value}"`);
            console.log(`Populating ${field} with content: "${value}"`);
            await clearAndType(page, textareaSelector, value);
          }, `Populating ${field}`, 1); // One retry for the whole operation
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Failed to populate ${field} with selector "${textareaSelector}":`, error);
          
          // Check if it's a session closed error
          if (errorMessage.includes('Session closed') || 
              errorMessage.includes('Protocol error') || 
              errorMessage.includes('page session was closed') ||
              errorMessage.includes('Page is no longer valid') ||
              errorMessage.includes('TargetCloseError')) {
            const userFriendlyError = formatUserError(errorMessage, `populating ${field}`);
            safeEmit(uid, 'error', userFriendlyError);
            isBrowserClosed = true;
            await closeSessionOnly(sessionId);
            throw new Error(`Browser session closed while populating ${field}. Please retry the operation.`);
          } else {
            const userFriendlyError = formatUserError(errorMessage, `populating ${field}`);
            safeEmit(uid, 'error', userFriendlyError);
            throw error;
          }
        }
      }
    } else if (serviceTypeIdentifier.toLowerCase() === "47e") {
      console.log('Service Type Identifier is "47e". Populating Note Summary.');
      safeEmit(uid, 'progress', `Populating Note Summary.`);
      const textareaSelector = `#NewNoteValues_0__0_`;
      const noteContent = noteSummary47e || '';
      
      try {
        await retryOperation(async () => {
          // Validate page state before operation
          if (!(await isPageValid(page))) {
            throw new Error(`Page session was closed before populating Note Summary`);
          }

          await waitForSelectorWithValidation(page, textareaSelector, { 
            visible: true, 
            timeout: defaultTimeout,
            retries: 1
          });
          await clearAndType(page, textareaSelector, noteContent);
          console.log(`Populated Note Summary: "${noteContent}"`);
        }, `Populating Note Summary`, 1);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to populate Note Summary with selector "${textareaSelector}":`, error);
        
        // Check if it's a session closed error
        if (errorMessage.includes('Session closed') || 
            errorMessage.includes('Protocol error') || 
            errorMessage.includes('page session was closed') ||
            errorMessage.includes('Page is no longer valid') ||
            errorMessage.includes('TargetCloseError')) {
          const userFriendlyError = formatUserError(errorMessage, 'populating Note Summary');
          safeEmit(uid, 'error', userFriendlyError);
          isBrowserClosed = true;
          await closeSessionOnly(sessionId);
          throw new Error(`Browser session closed while populating Note Summary. Please retry the operation.`);
        } else {
          const userFriendlyError = formatUserError(errorMessage, 'populating Note Summary');
          safeEmit(uid, 'error', userFriendlyError);
          throw error;
        }
      }
    } else {
      console.log('Service Type Identifier is neither "56a" nor "47e". Skipping observation notes population.');
    }

    safeEmit(uid, 'success', 'Observations completed!');
    testConnection('after_observations');
    console.log("ready to save the note");
    await saveAndReadyNote();

    if (mileageStartAddress && mileageStartAddress.trim() !== '') {
      
      const mileageTabSelector = 'a[href*="/dfcs/notes/trips"]';
      await waitForSelectorWithValidation(page, mileageTabSelector, { visible: true, timeout: defaultTimeout });
      await page.click(mileageTabSelector);
      console.log('Clicked on the "Mileage" tab');

      await processMileageTable(page);

      const mileageStartAddressSelector = "#DataModels_0__StartAddress";
      const mileageStartMileageSelector = "#DataModels_0__StartMileage";
      await populateStartDetails(page, mileageStartAddress, mileageStartMileage || '', mileageStartAddressSelector, mileageStartMileageSelector);
      
      console.log("entering end addresses");
      await sleep(300); // Reduced from 1000ms
      await populateMileageEntries(page, endAddresses, additionalDropdownValues);
      await saveAndReadyNote();
      
      console.log("Mileage Successfully Saved!");
      safeEmit(uid, 'success', 'Mileage Saved Successfully!');
      safeEmit(uid, 'toast', 'Mileage Saved Successfully!');
      safeEmit(uid, 'finished', 'Process Completed!');
      safeEmit(uid, 'toast', 'Process Completed!');
    } else {
      console.log('Include Mileage is false. Skipping mileage processing.');
      // Emit note data without mileage for history tracking, but preserve existing endMileage values
      const noteData = {
        dateOfService,
        startTime,
        endTime,
        capturedAt: new Date().toISOString()
      };
      safeEmit(uid, 'noteProcessed', noteData);
      console.log("Note data emitted for history update (no mileage):", noteData);
      
      safeEmit(uid, 'finished', 'Process Completed!');
      safeEmit(uid, 'toast', 'Process Completed!');
    }
    
    testConnection('process_complete');
    safeEmit(uid, 'script_completed', { 
      timestamp: new Date().toISOString(),
      success: true 
    });
    await closeSessionOnly(sessionId);

  } catch (error) {
    // Clear the keep-alive interval
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
    }
    
    safeEmit(uid, 'error', `An unexpected error occurred: ${error}`);
    console.error("An unexpected error occurred:", error);
    
    testConnection('process_error');
    safeEmit(uid, 'script_completed', { 
      timestamp: new Date().toISOString(),
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
    
    isBrowserClosed = true;
    await closeSessionOnly(sessionId);
    throw error;

  } finally {
    // Clear the keep-alive interval
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
    }
    
    isBrowserClosed = true;
    if (browser && !isBrowserClosed) {
      await closeSessionOnly(sessionId);
    }
    console.log("Session closed");
  }
}

export default runPuppeteerScript;
