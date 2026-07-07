<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Behind Cloudflare/a reverse proxy the real client IP and scheme arrive
        // in X-Forwarded-* headers. Trust ONLY the proxies we actually sit
        // behind — Cloudflare's published ranges (https://www.cloudflare.com/ips/)
        // plus loopback/private nets for the local nginx hop. Trusting '*'
        // would let any direct client spoof X-Forwarded-For and rotate its
        // identity past the per-IP rate limiter.
        $middleware->trustProxies(
            at: [
                // Local / private (nginx on the same box or LAN).
                '127.0.0.0/8', '::1',
                '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
                // Cloudflare IPv4.
                '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22',
                '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
                '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22',
                '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
                '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
                // Cloudflare IPv6.
                '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32',
                '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29',
                '2c0f:f248::/32',
            ],
            headers: Request::HEADER_X_FORWARDED_FOR
                | Request::HEADER_X_FORWARDED_HOST
                | Request::HEADER_X_FORWARDED_PORT
                | Request::HEADER_X_FORWARDED_PROTO,
        );

        // Baseline security headers on every response (API + prerendered HTML).
        $middleware->append(App\Http\Middleware\SecurityHeaders::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );
    })->create();
