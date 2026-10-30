import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const CONF = path.join(ROOT, 'nginx.conf');

/** The configuration with comments removed, so a commented-out directive neither passes nor fails a check. */
const conf = fs
  .readFileSync(CONF, 'utf-8')
  .split('\n')
  .map((line) => line.replace(/#.*$/, ''))
  .join('\n');

/** Every occurrence of a directive, as the text between its name and the semicolon that ends it. */
const directives = (name: string): string[] =>
  [...conf.matchAll(new RegExp(`(?:^|[\\s{;])${name}\\s+([^;]*);`, 'g'))].map((match) =>
    match[1].trim(),
  );

describe('the baked nginx configuration', () => {
  // The console sends each user's bearer token on every asset fetch to this server, so the access log may hold the
  // method, the path and the status, never a header, a cookie or the query string.
  const formats = directives('log_format');

  it('defines one log format, named plugin', () => {
    expect(formats).toHaveLength(1);
    expect(formats[0]).toMatch(/^plugin\s+'/);
  });

  it('logs the method, the path without its query and the status', () => {
    for (const variable of ['$request_method', '$uri', '$status']) {
      expect(formats[0]).toContain(variable);
    }
  });

  it.each([
    ['the full request line, which carries the query string', /\$request(?![_a-z])/],
    ['the request URI with its query string', /\$request_uri\b/],
    ['the query string', /\$args\b|\$arg_|\$query_string\b/],
    ['the user decoded from a Basic Authorization header', /\$remote_user\b/],
    ['a request header', /\$http_/],
    ['a cookie', /\$cookie_/],
    ['the request body', /\$request_body\b/],
  ])('never logs %s', (_label, pattern) => {
    expect(conf).not.toMatch(pattern);
  });

  it('writes the access log to standard output in that format only', () => {
    expect(directives('access_log')).toEqual(['/dev/stdout plugin']);
  });

  it('never falls back to the combined format', () => {
    expect(conf).not.toMatch(/\bcombined\b/);
  });

  it('writes the error log to standard error and the pid file under /tmp', () => {
    expect(directives('error_log')).toEqual(['/dev/stderr notice']);
    expect(directives('pid')).toEqual(['/tmp/nginx.pid']);
  });

  it('keeps every temporary path under /tmp, the only writable directory', () => {
    const temps = ['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'];
    for (const kind of temps) {
      const paths = directives(`${kind}_temp_path`);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toMatch(/^\/tmp\//);
    }
    expect([...conf.matchAll(/\b(\w+)_temp_path\b/g)].map((match) => match[1]).sort()).toEqual(
      [...temps].sort(),
    );
  });

  it('serves TLS on 9443 with the serving certificate', () => {
    expect(directives('listen')).toEqual(['9443 ssl', '[::]:9443 ssl']);
    expect(directives('ssl_certificate')).toEqual(['/var/cert/tls.crt']);
    expect(directives('ssl_certificate_key')).toEqual(['/var/cert/tls.key']);
    expect(directives('ssl_protocols')).toEqual(['TLSv1.2 TLSv1.3']);
  });

  // /usr/share/nginx/html holds the base image's welcome and error pages, which the plugin server must not serve.
  it('serves only the files of the bundle', () => {
    expect(directives('include')).toEqual(['/etc/nginx/mime.types']);
    expect(directives('root')).toEqual(['/usr/share/nginx/plugin']);
    expect(conf).not.toMatch(/\/usr\/share\/nginx\/html\b/);
    expect(directives('index')).toEqual([]);
    expect(directives('error_page')).toEqual([]);
    expect(directives('try_files')).toEqual(['$uri =404']);
    expect(directives('server_tokens')).toEqual(['off']);
    expect(conf).not.toMatch(/\bautoindex\s+on\b/);
  });

  it('proxies, forwards and redirects nothing', () => {
    expect(conf).not.toMatch(/\b(proxy|fastcgi|uwsgi|scgi|grpc)_pass\b/);
    expect(conf).not.toMatch(/\breturn\s+3\d\d\b/);
    expect(conf).not.toMatch(/\brewrite\b/);
  });
});
