ALTER TABLE profiles
    ADD COLUMN about_me VARCHAR(500) NOT NULL DEFAULT '';

ALTER TABLE profiles
    ADD CONSTRAINT profiles_about_me_length
        CHECK (char_length(about_me) <= 500),
    ADD CONSTRAINT profiles_about_me_plain_text
        CHECK (regexp_replace(about_me, E'[\\n\\r\\t]', '', 'g') !~ '[[:cntrl:]]');
