package com.youpi.observer;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.RectF;
import android.hardware.Camera;
import android.os.Build;
import android.os.Bundle;
import android.os.Vibrator;
import android.util.Log;
import android.view.Gravity;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;

import java.util.List;

/**
 * Native Camera QR Scanner for SMS Gateway Device Pairing.
 * Uses Camera preview stream with Google ZXing QR decoder for instantaneous pairing.
 */
@SuppressWarnings("deprecation")
public class QrScannerActivity extends Activity implements SurfaceHolder.Callback, Camera.PreviewCallback {
    private static final String TAG = "QrScannerActivity";
    public static final String EXTRA_QR_PAYLOAD = "qr_payload";

    private Camera camera;
    private SurfaceView surfaceView;
    private SurfaceHolder surfaceHolder;
    private boolean isDecoding = false;
    private QRCodeReader qrCodeReader;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        qrCodeReader = new QRCodeReader();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        // 1. Camera Preview Surface
        surfaceView = new SurfaceView(this);
        surfaceHolder = surfaceView.getHolder();
        surfaceHolder.addCallback(this);
        root.addView(surfaceView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // 2. Custom Reticle Overlay View
        ReticleOverlayView overlayView = new ReticleOverlayView(this);
        root.addView(overlayView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // 3. Header & Controls
        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.VERTICAL);
        controls.setPadding(32, 64, 32, 32);

        TextView tvTitle = new TextView(this);
        tvTitle.setText("Pair SMS Gateway");
        tvTitle.setTextColor(Color.WHITE);
        tvTitle.setTextSize(20f);
        tvTitle.setGravity(Gravity.CENTER_HORIZONTAL);
        controls.addView(tvTitle);

        TextView tvDesc = new TextView(this);
        tvDesc.setText("Point camera at the Pairing QR code in the Merchant Admin panel");
        tvDesc.setTextColor(Color.parseColor("#94a3b8"));
        tvDesc.setTextSize(13f);
        tvDesc.setGravity(Gravity.CENTER_HORIZONTAL);
        tvDesc.setPadding(0, 8, 0, 0);
        controls.addView(tvDesc);

        root.addView(controls, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP
        ));

        // 4. Cancel / Close Button at bottom
        Button btnCancel = new Button(this);
        btnCancel.setText("Cancel");
        btnCancel.setTextColor(Color.WHITE);
        btnCancel.setBackgroundColor(Color.parseColor("#1e293b"));
        btnCancel.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                setResult(RESULT_CANCELED);
                finish();
            }
        });

        FrameLayout.LayoutParams btnParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        btnParams.setMargins(48, 0, 48, 64);
        root.addView(btnCancel, btnParams);

        setContentView(root);
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        try {
            camera = Camera.open();
            camera.setDisplayOrientation(90);
            camera.setPreviewDisplay(holder);
        } catch (Exception e) {
            Log.e(TAG, "Error opening camera: " + e.getMessage());
            Toast.makeText(this, "Failed to initialize camera: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            finish();
        }
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        if (camera == null) return;
        try {
            Camera.Parameters params = camera.getParameters();
            List<Camera.Size> sizes = params.getSupportedPreviewSizes();
            if (sizes != null && !sizes.isEmpty()) {
                // Select optimal preview size
                Camera.Size optimal = sizes.get(0);
                for (Camera.Size s : sizes) {
                    if (s.width >= 1280 && s.width <= 1920) {
                        optimal = s;
                        break;
                    }
                }
                params.setPreviewSize(optimal.width, optimal.height);
            }

            // Continuous autofocus if supported
            List<String> focusModes = params.getSupportedFocusModes();
            if (focusModes != null && focusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
                params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            }

            camera.setParameters(params);
            camera.startPreview();
            isDecoding = false;
            camera.setOneShotPreviewCallback(this);
        } catch (Exception e) {
            Log.e(TAG, "surfaceChanged error: " + e.getMessage());
        }
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        if (camera != null) {
            try {
                camera.setOneShotPreviewCallback(null);
                camera.stopPreview();
                camera.release();
            } catch (Exception ignored) {}
            camera = null;
        }
    }

    @Override
    public void onPreviewFrame(final byte[] data, final Camera camera) {
        if (isDecoding || camera == null) return;
        isDecoding = true;

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Camera.Parameters params = camera.getParameters();
                    Camera.Size size = params.getPreviewSize();
                    int width = size.width;
                    int height = size.height;

                    PlanarYUVLuminanceSource source = new PlanarYUVLuminanceSource(
                        data, width, height, 0, 0, width, height, false);
                    BinaryBitmap bitmap = new BinaryBitmap(new HybridBinarizer(source));

                    Result result = qrCodeReader.decode(bitmap);
                    if (result != null && result.getText() != null && !result.getText().trim().isEmpty()) {
                        final String qrPayload = result.getText().trim();
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                onQrCodeScanned(qrPayload);
                            }
                        });
                        return;
                    }
                } catch (Exception ignored) {
                    // Normal when QR code is not in frame
                }

                // If not found, request next frame
                if (!isFinishing()) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            isDecoding = false;
                            if (camera != null) {
                                try {
                                    camera.setOneShotPreviewCallback(QrScannerActivity.this);
                                } catch (Exception ignored) {}
                            }
                        }
                    });
                }
            }
        }).start();
    }

    private void onQrCodeScanned(String qrPayload) {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                v.vibrate(80);
            }
        } catch (Exception ignored) {}

        Intent resultIntent = new Intent();
        resultIntent.putExtra(EXTRA_QR_PAYLOAD, qrPayload);
        setResult(RESULT_OK, resultIntent);
        finish();
    }

    /**
     * Dark translucent HUD overlay with clear reticle framing.
     */
    private static class ReticleOverlayView extends View {
        private final Paint maskPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint borderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint cornerPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF frameRect = new RectF();

        public ReticleOverlayView(Context context) {
            super(context);
            setLayerType(LAYER_TYPE_SOFTWARE, null);

            maskPaint.setColor(Color.parseColor("#99000000"));

            borderPaint.setColor(Color.parseColor("#38bdf8"));
            borderPaint.setStyle(Paint.Style.STROKE);
            borderPaint.setStrokeWidth(3f);

            cornerPaint.setColor(Color.parseColor("#10b981"));
            cornerPaint.setStyle(Paint.Style.STROKE);
            cornerPaint.setStrokeWidth(8f);
            cornerPaint.setStrokeCap(Paint.Cap.ROUND);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int width = getWidth();
            int height = getHeight();
            float boxSize = Math.min(width, height) * 0.70f;
            float left = (width - boxSize) / 2f;
            float top = (height - boxSize) / 2f;
            frameRect.set(left, top, left + boxSize, top + boxSize);

            // Semi-transparent blackout
            canvas.drawRect(0, 0, width, height, maskPaint);

            // Punch hole in center for QR view
            Paint clearPaint = new Paint();
            clearPaint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));
            canvas.drawRoundRect(frameRect, 24f, 24f, clearPaint);

            // Thin frame border
            canvas.drawRoundRect(frameRect, 24f, 24f, borderPaint);

            // Green targeting corner accents
            float cornerLen = 36f;
            // Top-Left
            canvas.drawLine(left, top + cornerLen, left, top, cornerPaint);
            canvas.drawLine(left, top, left + cornerLen, top, cornerPaint);
            // Top-Right
            canvas.drawLine(left + boxSize - cornerLen, top, left + boxSize, top, cornerPaint);
            canvas.drawLine(left + boxSize, top, left + boxSize, top + cornerLen, cornerPaint);
            // Bottom-Left
            canvas.drawLine(left, top + boxSize - cornerLen, left, top + boxSize, cornerPaint);
            canvas.drawLine(left, top + boxSize, left + cornerLen, top + boxSize, cornerPaint);
            // Bottom-Right
            canvas.drawLine(left + boxSize - cornerLen, top + boxSize, left + boxSize, top + boxSize, cornerPaint);
            canvas.drawLine(left + boxSize, top + boxSize - cornerLen, left + boxSize, top + boxSize, cornerPaint);
        }
    }
}
