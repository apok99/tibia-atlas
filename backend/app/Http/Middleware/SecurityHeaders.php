<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Baseline hardening headers on every response. Registered globally in
 * bootstrap/app.php so the JSON API, sitemaps and the crawler-facing
 * prerender HTML all carry them, independent of the nginx config.
 */
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // PHP's SAPI adds X-Powered-By (expose_php) outside Symfony's header
        // bag — strip it so responses don't advertise the PHP version.
        if (! app()->runningInConsole()) {
            header_remove('X-Powered-By');
        }

        $headers = $response->headers;

        $headers->set('X-Content-Type-Options', 'nosniff');
        $headers->set('X-Frame-Options', 'SAMEORIGIN');
        $headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $headers->set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        $headers->set('Cross-Origin-Opener-Policy', 'same-origin');

        // Only meaningful over TLS; setting it on plain-HTTP dev responses
        // would be ignored anyway, but keep dev clean.
        if ($request->secure()) {
            $headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $response;
    }
}
