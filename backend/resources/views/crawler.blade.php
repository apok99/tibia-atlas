<!doctype html>
<html lang="{{ $lang }}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ $title }}</title>
  <meta name="description" content="{{ $description }}">
  <link rel="canonical" href="{{ $canonical }}">
  @if(!empty($noindex))<meta name="robots" content="noindex, follow">@endif
  <link rel="alternate" hreflang="es" href="{{ $canonical }}?lang=es">
  <link rel="alternate" hreflang="en" href="{{ $canonical }}?lang=en">
  <link rel="alternate" hreflang="x-default" href="{{ $canonical }}">

  <meta property="og:site_name" content="Tibia Atlas">
  <meta property="og:title" content="{{ $ogTitle ?? $title }}">
  <meta property="og:description" content="{{ $description }}">
  <meta property="og:type" content="{{ $ogType ?? 'website' }}">
  <meta property="og:url" content="{{ $canonical }}">
  <meta property="og:image" content="{{ $image }}">
  <meta property="og:locale" content="{{ $lang === 'es' ? 'es_ES' : 'en_US' }}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{{ $ogTitle ?? $title }}">
  <meta name="twitter:description" content="{{ $description }}">
  <meta name="twitter:image" content="{{ $image }}">

  @foreach(($jsonLd ?? []) as $block)
  <script type="application/ld+json">{!! json_encode($block, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) !!}</script>
  @endforeach
</head>
<body>
  <header>
    <a href="{{ $site }}"><strong>Tibia Atlas</strong></a> — {{ $lang === 'es' ? 'El archivo viviente del lore de Tibia' : 'The living archive of Tibian lore' }}
  </header>
  <main>
    {!! $body !!}
  </main>
  <footer>
    <p>Tibia Atlas — {{ $lang === 'es' ? 'Proyecto de fans, no afiliado a CipSoft.' : 'Fan project, not affiliated with CipSoft.' }}</p>
  </footer>
</body>
</html>
