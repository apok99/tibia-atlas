<?php

namespace App\Providers;

use App\Models\User;
use Illuminate\Support\Facades\Gate;
use Laravel\Telescope\IncomingEntry;
use Laravel\Telescope\Telescope;
use Laravel\Telescope\TelescopeApplicationServiceProvider;

class TelescopeServiceProvider extends TelescopeApplicationServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Telescope::night();

        $this->hideSensitiveRequestDetails();

        // Record everything — this is an active monitoring dashboard, not just an
        // error log. Growth is bounded by the daily 3-day prune (routes/console.php).
        Telescope::filter(fn (IncomingEntry $entry) => true);
    }

    /**
     * Prevent sensitive request details from being logged by Telescope.
     */
    protected function hideSensitiveRequestDetails(): void
    {
        if ($this->app->environment('local')) {
            return;
        }

        Telescope::hideRequestParameters(['_token']);

        Telescope::hideRequestHeaders([
            'cookie',
            'x-csrf-token',
            'x-xsrf-token',
            'authorization',   // don't store admin Sanctum bearer tokens
        ]);
    }

    /**
     * Register the Telescope gate.
     *
     * This gate determines who can access Telescope in non-local environments.
     */
    protected function gate(): void
    {
        // Defence in depth: nginx puts HTTP Basic Auth in front of /telescope,
        // but the app must not be wide open if that layer is ever misconfigured.
        // Outside local, only IPs listed in TELESCOPE_ALLOWED_IPS get through
        // (empty list = nobody). The public site is a token-auth SPA, so there
        // is no web-session user to authorize here.
        Gate::define('viewTelescope', function (?User $user = null): bool {
            if ($this->app->environment('local')) {
                return true;
            }

            $allowed = array_filter(array_map('trim', explode(',', (string) config('telescope.allowed_ips', ''))));

            return in_array(request()->ip(), $allowed, true);
        });
    }
}
