from twilio.rest import Client
from config import TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_TO_NUMBER

def broadcast_voice_alert(message: str):
    """
    Uses Twilio to place a voice call and read the diagnostic message.
    """
    if not all([TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_TO_NUMBER]):
        print("⚠️ Twilio not configured. Skipping voice broadcast.")
        return

    try:
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        
        # We use TwiML to define what the voice says
        twiml = f'<Response><Say voice="alice">{message}</Say></Response>'
        
        call = client.calls.create(
            twiml=twiml,
            to=TWILIO_TO_NUMBER,
            from_=TWILIO_FROM_NUMBER
        )
        print(f"📞 Voice alert initiated! Call SID: {call.sid}")
    except Exception as e:
        print(f"❌ Failed to initiate voice alert: {e}")
