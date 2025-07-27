
/* urlGet */

#define URL_GET_PROGRAM "curl -s -i --"
#define URL_GET_BUF_SIZE 4096

static int http_get_header_line(FILE *f, char *buf, size_t buf_size,
                                DynBuf *dbuf)
{
    int c;
    char *p;

    p = buf;
    for(;;) {
        c = fgetc(f);
        if (c < 0)
            return -1;
        if ((p - buf) < buf_size - 1)
            *p++ = c;
        if (dbuf)
            dbuf_putc(dbuf, c);
        if (c == '\n')
            break;
    }
    *p = '\0';
    return 0;
}

static int http_get_status(const char *buf)
{
    const char *p = buf;
    while (*p != ' ' && *p != '\0')
        p++;
    if (*p != ' ')
        return 0;
    while (*p == ' ')
        p++;
    return atoi(p);
}

static JSValue js_std_urlGet(JSContext *ctx, JSValueConst this_val,
                             int argc, JSValueConst *argv)
{
    const char *url;
    DynBuf cmd_buf;
    DynBuf data_buf_s, *data_buf = &data_buf_s;
    DynBuf header_buf_s, *header_buf = &header_buf_s;
    char *buf;
    size_t i, len;
    int status;
    JSValue response = JS_UNDEFINED, ret_obj;
    JSValueConst options_obj;
    FILE *f;
    BOOL binary_flag, full_flag;

    url = JS_ToCString(ctx, argv[0]);
    if (!url)
        return JS_EXCEPTION;

    binary_flag = FALSE;
    full_flag = FALSE;

    if (argc >= 2) {
        options_obj = argv[1];

        if (get_bool_option(ctx, &binary_flag, options_obj, "binary"))
            goto fail_obj;

        if (get_bool_option(ctx, &full_flag, options_obj, "full")) {
        fail_obj:
            JS_FreeCString(ctx, url);
            return JS_EXCEPTION;
        }
    }

    js_std_dbuf_init(ctx, &cmd_buf);
    dbuf_printf(&cmd_buf, "%s '", URL_GET_PROGRAM);
    for(i = 0; url[i] != '\0'; i++) {
        unsigned char c = url[i];
        switch (c) {
        case '\'':
            /* shell single quoted string does not support \' */
            dbuf_putstr(&cmd_buf, "'\\''");
            break;
        case '[': case ']': case '{': case '}': case '\\':
            /* prevent interpretation by curl as range or set specification */
            dbuf_putc(&cmd_buf, '\\');
            /* FALLTHROUGH */
        default:
            dbuf_putc(&cmd_buf, c);
            break;
        }
    }
    JS_FreeCString(ctx, url);
    dbuf_putstr(&cmd_buf, "'");
    dbuf_putc(&cmd_buf, '\0');
    if (dbuf_error(&cmd_buf)) {
        dbuf_free(&cmd_buf);
        return JS_EXCEPTION;
    }
    //    printf("%s\n", (char *)cmd_buf.buf);
    f = popen((char *)cmd_buf.buf, "r");
    dbuf_free(&cmd_buf);
    if (!f) {
        return JS_ThrowTypeError(ctx, "could not start curl");
    }

    js_std_dbuf_init(ctx, data_buf);
    js_std_dbuf_init(ctx, header_buf);

    buf = js_malloc(ctx, URL_GET_BUF_SIZE);
    if (!buf)
        goto fail;

    /* get the HTTP status */
    if (http_get_header_line(f, buf, URL_GET_BUF_SIZE, NULL) < 0) {
        status = 0;
        goto bad_header;
    }
    status = http_get_status(buf);
    if (!full_flag && !(status >= 200 && status <= 299)) {
        goto bad_header;
    }

    /* wait until there is an empty line */
    for(;;) {
        if (http_get_header_line(f, buf, URL_GET_BUF_SIZE, header_buf) < 0) {
        bad_header:
            response = JS_NULL;
            goto done;
        }
        if (!strcmp(buf, "\r\n"))
            break;
    }
    if (dbuf_error(header_buf))
        goto fail;
    header_buf->size -= 2; /* remove the trailing CRLF */

    /* download the data */
    for(;;) {
        len = fread(buf, 1, URL_GET_BUF_SIZE, f);
        if (len == 0)
            break;
        dbuf_put(data_buf, (uint8_t *)buf, len);
    }
    if (dbuf_error(data_buf))
        goto fail;
    if (binary_flag) {
        response = JS_NewArrayBufferCopy(ctx,
                                         data_buf->buf, data_buf->size);
    } else {
        response = JS_NewStringLen(ctx, (char *)data_buf->buf, data_buf->size);
    }
    if (JS_IsException(response))
        goto fail;
 done:
    js_free(ctx, buf);
    buf = NULL;
    pclose(f);
    f = NULL;
    dbuf_free(data_buf);
    data_buf = NULL;

    if (full_flag) {
        ret_obj = JS_NewObject(ctx);
        if (JS_IsException(ret_obj))
            goto fail;
        JS_DefinePropertyValueStr(ctx, ret_obj, "response",
                                  response,
                                  JS_PROP_C_W_E);
        if (!JS_IsNull(response)) {
            JS_DefinePropertyValueStr(ctx, ret_obj, "responseHeaders",
                                      JS_NewStringLen(ctx, (char *)header_buf->buf,
                                                      header_buf->size),
                                      JS_PROP_C_W_E);
            JS_DefinePropertyValueStr(ctx, ret_obj, "status",
                                      JS_NewInt32(ctx, status),
                                      JS_PROP_C_W_E);
        }
    } else {
        ret_obj = response;
    }
    dbuf_free(header_buf);
    return ret_obj;
 fail:
    if (f)
        pclose(f);
    js_free(ctx, buf);
    if (data_buf)
        dbuf_free(data_buf);
    if (header_buf)
        dbuf_free(header_buf);
    JS_FreeValue(ctx, response);
    return JS_EXCEPTION;
}