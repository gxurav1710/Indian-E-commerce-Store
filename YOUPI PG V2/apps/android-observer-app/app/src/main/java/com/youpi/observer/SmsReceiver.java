package com.youpi.observer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;

public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "YoupiSmsReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) {
            return;
        }

        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) return;

        final ApiClient client = new ApiClient(context);
        if (!client.isPaired()) {
            Log.w(TAG, "SMS received but device is not paired with YouPI Gateway. Skipping.");
            return;
        }

        for (SmsMessage sms : messages) {
            if (sms == null) continue;
            final String sender = sms.getOriginatingAddress();
            final String body = sms.getMessageBody();
            final long timestamp = sms.getTimestampMillis();

            Log.i(TAG, "Captured incoming SMS from [" + sender + "]: " + (body != null ? body.length() : 0) + " chars");

            // Dispatch to YouPI Gateway in asynchronous worker thread
            new Thread(new Runnable() {
                @Override
                public void run() {
                    boolean success = client.sendSms(sender, body, timestamp);
                    Log.i(TAG, "Dispatched SMS to YouPI Gateway: " + (success ? "SUCCESS" : "FAILED"));
                }
            }).start();
        }
    }
}
